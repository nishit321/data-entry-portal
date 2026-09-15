import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { entityScopeFilter } from '../common/utils/data-scope.util';
import { CreateLevyRateDto, UpdateLevyRateDto } from './dto/levy-rate.dto';
import { LevyAssessmentQueryDto } from './dto/levy-query.dto';

/** Round a monetary amount to two decimal places (SSP), avoiding binary-float drift on display. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const rateSelect = {
  id: true,
  ratePercent: true,
  effectiveFrom: true,
  effectiveTo: true,
  label: true,
  createdAt: true,
} satisfies Prisma.LevyRateSelect;

@Injectable()
export class LevyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Rate configuration (ADMIN) ------------------------------------------

  listRates() {
    return this.prisma.levyRate.findMany({
      where: { deletedAt: null },
      orderBy: { effectiveFrom: 'desc' },
      select: rateSelect,
    });
  }

  async createRate(dto: CreateLevyRateDto, actorId: string, ctx: RequestContext) {
    const { from, to } = this.parseWindow(dto.effectiveFrom, dto.effectiveTo);
    const rate = await this.prisma.levyRate.create({
      data: {
        ratePercent: new Prisma.Decimal(dto.ratePercent),
        effectiveFrom: from,
        effectiveTo: to,
        label: dto.label?.trim() || null,
        createdById: actorId,
      },
      select: rateSelect,
    });
    await this.record(AuditAction.LEVY_RATE_CREATED, rate.id, actorId, ctx, {
      ratePercent: dto.ratePercent,
    });
    return rate;
  }

  async updateRate(id: string, dto: UpdateLevyRateDto, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.levyRate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    if (!existing) throw new NotFoundException('Levy rate not found');
    const fromStr = dto.effectiveFrom ?? existing.effectiveFrom.toISOString();
    const toStr =
      dto.effectiveTo === undefined
        ? (existing.effectiveTo?.toISOString() ?? undefined)
        : (dto.effectiveTo ?? undefined);
    const { from, to } = this.parseWindow(fromStr, toStr);
    const rate = await this.prisma.levyRate.update({
      where: { id },
      data: {
        ratePercent:
          dto.ratePercent !== undefined ? new Prisma.Decimal(dto.ratePercent) : undefined,
        effectiveFrom: dto.effectiveFrom ? from : undefined,
        effectiveTo: dto.effectiveTo === undefined ? undefined : to,
        label: dto.label?.trim(),
      },
      select: rateSelect,
    });
    await this.record(AuditAction.LEVY_RATE_UPDATED, id, actorId, ctx, { changes: { ...dto } });
    return rate;
  }

  async removeRate(id: string, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.levyRate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Levy rate not found');
    await this.prisma.levyRate.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(AuditAction.LEVY_RATE_DELETED, id, actorId, ctx);
    return { message: 'Levy rate removed' };
  }

  private parseWindow(fromStr: string, toStr?: string) {
    const from = new Date(fromStr);
    const to = toStr ? new Date(toStr) : null;
    if (to && to <= from) {
      throw new BadRequestException('The end date must be after the start date.');
    }
    return { from, to };
  }

  /** The levy rate whose window covers a given date, or null if none is configured for it. */
  private rateForDate(date: Date) {
    return this.prisma.levyRate.findFirst({
      where: {
        deletedAt: null,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      // Most recent applicable window wins if configs overlap.
      orderBy: { effectiveFrom: 'desc' },
      select: rateSelect,
    });
  }

  // --- Assessment (operators + Authority, scoped) --------------------------

  /**
   * Compute the levy owed for a reporting period: each operator's assessable (approved) revenue
   * times the rate in force for that period. Read-only and always live — nothing is persisted, so a
   * revised or re-approved return is reflected immediately.
   */
  async assessments(user: AuthUser, query: LevyAssessmentQueryDto) {
    const scoped = entityScopeFilter(user); // operator → own id; authority → undefined
    const entityId = scoped ?? query.entityId;

    const periodId = query.periodId ?? (await this.latestAssessablePeriod(entityId));
    if (!periodId) return this.emptyResult();

    const period = await this.prisma.reportingPeriod.findFirst({
      where: { id: periodId, deletedAt: null },
      select: {
        id: true,
        label: true,
        dueDate: true,
        // The exchange rate the Authority set for this cycle, and the day they set it. Held on the
        // period rather than as one current rate, so restating this quarter never restates a year
        // that has already been audited — NCA's instruction, 3 September 2026.
        usdRate: true,
        usdRateAt: true,
        template: {
          select: {
            name: true,
            sections: {
              select: { fields: { where: { isLevyBasis: true }, select: { id: true } } },
            },
          },
        },
      },
    });
    if (!period) throw new NotFoundException('Reporting period not found');

    const levyFieldIds = period.template.sections.flatMap((s) => s.fields.map((f) => f.id));
    const rate = await this.rateForDate(period.dueDate);
    const ratePercent = rate ? Number(rate.ratePercent) : null;

    /*
     * The same figures in USD, at the rate this period was assessed under.
     *
     * Every amount in the portal is SSP; USD is a second reading of the same number, not a second
     * number. So it is derived here rather than stored, and derived from the period's own rate —
     * the one point of holding the rate per period is that a figure converted last year stays
     * converted at last year's rate.
     *
     * A period with no rate yet gives `null`, never zero. Zero is a figure and would be read as
     * one; null is the screen saying it cannot tell you, which is the truth.
     */
    const usdRate = period.usdRate === null ? null : Number(period.usdRate);
    const toUsd = (ssp: number | null): number | null =>
      usdRate === null || usdRate <= 0 || ssp === null ? null : round2(ssp / usdRate);

    const submissions = await this.prisma.submission.findMany({
      where: {
        periodId,
        status: SubmissionStatus.APPROVED,
        deletedAt: null,
        supersededBy: null,
        entityId,
      },
      select: {
        entity: { select: { id: true, name: true, type: true } },
        values:
          levyFieldIds.length > 0
            ? { where: { fieldId: { in: levyFieldIds } }, select: { valueText: true } }
            : false,
      },
      orderBy: { entity: { name: 'asc' } },
    });

    const rows = submissions.map((sub) => {
      const revenue = round2(
        (sub.values ?? []).reduce((sum, v) => sum + (Number(v.valueText) || 0), 0),
      );
      const levyDue = ratePercent !== null ? round2((revenue * ratePercent) / 100) : null;
      return {
        entity: sub.entity,
        assessableRevenue: revenue,
        levyDue,
        assessableRevenueUsd: toUsd(revenue),
        levyDueUsd: toUsd(levyDue),
      };
    });

    return {
      period: { id: period.id, label: period.label, dueDate: period.dueDate },
      template: { name: period.template.name },
      levyBasisConfigured: levyFieldIds.length > 0,
      rate: rate ? { id: rate.id, ratePercent, label: rate.label } : null,
      /*
       * The exchange rate is reported alongside the figures, not left implicit.
       *
       * A reader comparing two years of USD columns has to be able to see why they differ — and
       * the answer is usually the rate, not the business. Hiding it turns a conversion into a
       * claim nobody can check.
       */
      exchange: usdRate === null ? null : { sspPerUsd: usdRate, setAt: period.usdRateAt },
      totals: (() => {
        const totalRevenue = round2(rows.reduce((sum, r) => sum + r.assessableRevenue, 0));
        const totalLevyDue =
          ratePercent !== null ? round2(rows.reduce((sum, r) => sum + (r.levyDue ?? 0), 0)) : null;
        return {
          operatorsAssessed: rows.length,
          totalRevenue,
          totalLevyDue,
          // Converted from the total, not summed from the rows: adding rounded halves drifts from
          // the rounded whole, and the two figures sit next to each other on screen.
          totalRevenueUsd: toUsd(totalRevenue),
          totalLevyDueUsd: toUsd(totalLevyDue),
        };
      })(),
      rows,
    };
  }

  /** The most recent period (by due date) that has an approved return within the reader's scope. */
  private async latestAssessablePeriod(entityId?: string): Promise<string | null> {
    const latest = await this.prisma.submission.findFirst({
      where: {
        status: SubmissionStatus.APPROVED,
        deletedAt: null,
        supersededBy: null,
        entityId,
      },
      orderBy: { period: { dueDate: 'desc' } },
      select: { periodId: true },
    });
    return latest?.periodId ?? null;
  }

  private emptyResult() {
    return {
      period: null,
      template: null,
      levyBasisConfigured: false,
      rate: null,
      exchange: null,
      totals: {
        operatorsAssessed: 0,
        totalRevenue: 0,
        totalLevyDue: null,
        totalRevenueUsd: null,
        totalLevyDueUsd: null,
      },
      rows: [],
    };
  }

  private record(
    action: AuditAction,
    rateId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'LevyRate',
      entityId: rateId,
      metadata,
      context: ctx,
    });
  }
}
