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
      return { entity: sub.entity, assessableRevenue: revenue, levyDue };
    });

    return {
      period: { id: period.id, label: period.label, dueDate: period.dueDate },
      template: { name: period.template.name },
      levyBasisConfigured: levyFieldIds.length > 0,
      rate: rate ? { id: rate.id, ratePercent, label: rate.label } : null,
      totals: {
        operatorsAssessed: rows.length,
        totalRevenue: round2(rows.reduce((sum, r) => sum + r.assessableRevenue, 0)),
        totalLevyDue:
          ratePercent !== null ? round2(rows.reduce((sum, r) => sum + (r.levyDue ?? 0), 0)) : null,
      },
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
      totals: { operatorsAssessed: 0, totalRevenue: 0, totalLevyDue: null },
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
