import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EnforcementReason, EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { CreatePenaltyRuleDto, UpdatePenaltyRuleDto } from './dto/penalty-rule.dto';
import type { PenaltyTerms } from './penalty-assessment';

const ruleSelect = {
  id: true,
  reason: true,
  entityType: true,
  fixedAmount: true,
  dailyAmount: true,
  maxAmount: true,
  minAmount: true,
  percentOfRevenue: true,
  label: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdAt: true,
} satisfies Prisma.PenaltyRuleSelect;

export type PenaltyRuleRow = Prisma.PenaltyRuleGetPayload<{ select: typeof ruleSelect }>;

/** Just the amounts, for a caller that priced a case and selected nothing else. */
export type PenaltyTermsRow = Pick<
  PenaltyRuleRow,
  'fixedAmount' | 'dailyAmount' | 'maxAmount' | 'minAmount' | 'percentOfRevenue'
>;

/**
 * NCA Legal & Licensing's penalty schedule, held as configuration (Q3).
 *
 * The amounts are entered by an administrator and effective-dated, the same shape the levy rates
 * already use. Keeping the schedule as data rather than code is not a convenience: a regulator's
 * penalty figures change by instrument, and a change that needs a deployment is a change that
 * happens late.
 */
@Injectable()
export class PenaltyScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.penaltyRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ effectiveFrom: 'desc' }, { entityType: 'asc' }],
      select: ruleSelect,
    });
  }

  async create(dto: CreatePenaltyRuleDto, actorId: string, ctx: RequestContext) {
    const { from, to } = this.parseWindow(dto.effectiveFrom, dto.effectiveTo);
    this.assertAmounts(dto);

    const rule = await this.prisma.penaltyRule.create({
      data: {
        reason: dto.reason ?? EnforcementReason.MISSED_DEADLINE,
        entityType: dto.entityType ?? null,
        fixedAmount: new Prisma.Decimal(dto.fixedAmount ?? 0),
        dailyAmount: new Prisma.Decimal(dto.dailyAmount ?? 0),
        maxAmount: dto.maxAmount === undefined ? null : new Prisma.Decimal(dto.maxAmount),
        minAmount: dto.minAmount === undefined ? null : new Prisma.Decimal(dto.minAmount),
        percentOfRevenue:
          dto.percentOfRevenue === undefined ? null : new Prisma.Decimal(dto.percentOfRevenue),
        label: dto.label?.trim() || null,
        effectiveFrom: from,
        effectiveTo: to,
        createdById: actorId,
      },
      select: ruleSelect,
    });
    await this.record(AuditAction.PENALTY_RULE_CREATED, rule.id, actorId, ctx, { ...dto });
    return rule;
  }

  async update(id: string, dto: UpdatePenaltyRuleDto, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.penaltyRule.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        effectiveFrom: true,
        effectiveTo: true,
        fixedAmount: true,
        dailyAmount: true,
        maxAmount: true,
        minAmount: true,
        percentOfRevenue: true,
      },
    });
    if (!existing) throw new NotFoundException('Penalty schedule line not found');

    const fromStr = dto.effectiveFrom ?? existing.effectiveFrom.toISOString();
    const toStr =
      dto.effectiveTo === undefined
        ? (existing.effectiveTo?.toISOString() ?? undefined)
        : (dto.effectiveTo ?? undefined);
    const { from, to } = this.parseWindow(fromStr, toStr);
    // Validate the line as it will stand after the change, not just the fields that were sent:
    // an update that only renames the line must not be judged as if it zeroed the amounts.
    const orUndefined = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));
    this.assertAmounts({
      fixedAmount: dto.fixedAmount ?? Number(existing.fixedAmount),
      dailyAmount: dto.dailyAmount ?? Number(existing.dailyAmount),
      maxAmount: dto.maxAmount ?? orUndefined(existing.maxAmount),
      minAmount: dto.minAmount ?? orUndefined(existing.minAmount),
      percentOfRevenue: dto.percentOfRevenue ?? orUndefined(existing.percentOfRevenue),
    });

    const rule = await this.prisma.penaltyRule.update({
      where: { id },
      data: {
        reason: dto.reason,
        entityType: dto.entityType,
        fixedAmount:
          dto.fixedAmount === undefined ? undefined : new Prisma.Decimal(dto.fixedAmount),
        dailyAmount:
          dto.dailyAmount === undefined ? undefined : new Prisma.Decimal(dto.dailyAmount),
        maxAmount: dto.maxAmount === undefined ? undefined : new Prisma.Decimal(dto.maxAmount),
        minAmount: dto.minAmount === undefined ? undefined : new Prisma.Decimal(dto.minAmount),
        percentOfRevenue:
          dto.percentOfRevenue === undefined ? undefined : new Prisma.Decimal(dto.percentOfRevenue),
        label: dto.label?.trim(),
        effectiveFrom: dto.effectiveFrom ? from : undefined,
        effectiveTo: dto.effectiveTo === undefined ? undefined : to,
      },
      select: ruleSelect,
    });
    await this.record(AuditAction.PENALTY_RULE_UPDATED, id, actorId, ctx, { changes: { ...dto } });
    return rule;
  }

  /**
   * Retire a schedule line.
   *
   * Soft-deleted, never removed: cases already priced under this line point at it, and an amount
   * that cannot be traced back to the rule that produced it is an amount that cannot be defended.
   */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.penaltyRule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Penalty schedule line not found');
    await this.prisma.penaltyRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(AuditAction.PENALTY_RULE_DELETED, id, actorId, ctx);
    return { message: 'Penalty schedule line removed' };
  }

  /**
   * The line that prices a contravention: the one in force on the day the default began, for this
   * class of operator.
   *
   * A line naming an operator type beats a line that applies to everyone, so NCA can set a general
   * figure and override it for one class without having to write out every other class.
   */
  async ruleFor(
    reason: EnforcementReason,
    entityType: EntityType,
    on: Date,
  ): Promise<PenaltyRuleRow | null> {
    const candidates = await this.prisma.penaltyRule.findMany({
      where: {
        deletedAt: null,
        reason,
        OR: [{ entityType }, { entityType: null }],
        effectiveFrom: { lte: on },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] }],
      },
      // Most recent applicable window first, so a later instrument supersedes an earlier one.
      orderBy: { effectiveFrom: 'desc' },
      select: ruleSelect,
    });
    return (
      candidates.find((r) => r.entityType === entityType) ??
      candidates.find((r) => r.entityType === null) ??
      null
    );
  }

  /**
   * A stored rule as the arithmetic in `penalty-assessment` needs it.
   *
   * Takes only the terms, not a whole row: the callers that price a case select the schedule's
   * amounts and nothing else, and demanding the full row would push them into selecting columns
   * they have no use for — or, as happened, into rebuilding the terms by hand and leaving one out.
   */
  static toTerms(rule: PenaltyTermsRow): PenaltyTerms {
    return {
      fixedAmount: Number(rule.fixedAmount),
      dailyAmount: Number(rule.dailyAmount),
      /*
       * `== null`, catching undefined as well as null.
       *
       * `=== null` looked equivalent and was not: a caller whose select omits a column hands over
       * `undefined`, which slips past a strict null check into `Number(undefined)` — NaN. A NaN
       * percentage then looks like a percentage line and prices the case at zero, confidently. The
       * existing tests caught it, which is the only reason it is not in this file.
       */
      maxAmount: rule.maxAmount == null ? null : Number(rule.maxAmount),
      minAmount: rule.minAmount == null ? null : Number(rule.minAmount),
      percentOfRevenue: rule.percentOfRevenue == null ? null : Number(rule.percentOfRevenue),
    };
  }

  private record(
    action: AuditAction,
    ruleId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'PenaltyRule',
      entityId: ruleId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }

  private parseWindow(fromStr: string, toStr?: string) {
    const from = new Date(fromStr);
    const to = toStr ? new Date(toStr) : null;
    if (to && to <= from) {
      throw new BadRequestException('The end date must be after the start date.');
    }
    return { from, to };
  }

  /**
   * The line has to be able to charge something, and a cap below the day-one amount would never be
   * reachable. Both are mistakes that only show up when a real case is priced, which is far too
   * late to find them.
   */
  /**
   * A schedule line has to be one instrument or the other, and has to be some instrument.
   *
   * NCA's schedule has two shapes. Tier 1 runs on time — a fixed charge and so much a day. Tiers 2
   * and 3 run on size — a share of the operator's audited annual revenue. The arithmetic prices a
   * percentage line on the share alone, so a line carrying both would have its fixed and daily
   * amounts silently discarded. Refusing the combination is better than accepting a figure and
   * then not using it.
   */
  private assertAmounts(dto: {
    fixedAmount?: number;
    dailyAmount?: number;
    maxAmount?: number;
    minAmount?: number;
    percentOfRevenue?: number;
  }) {
    const fixed = dto.fixedAmount ?? 0;
    const daily = dto.dailyAmount ?? 0;
    const percent = dto.percentOfRevenue;

    if (percent !== undefined && percent > 0 && (fixed > 0 || daily > 0)) {
      throw new BadRequestException(
        'A line is either a share of revenue or an amount per day, not both. Enter the ' +
          'percentage on its own, or clear it and use the fixed and daily amounts.',
      );
    }
    if ((percent === undefined || percent === 0) && fixed === 0 && daily === 0) {
      throw new BadRequestException(
        'Set a fixed amount, a daily amount, or a percentage of revenue.',
      );
    }
    if (dto.maxAmount !== undefined && dto.maxAmount < fixed) {
      throw new BadRequestException('The maximum cannot be less than the fixed amount.');
    }
    if (
      dto.minAmount !== undefined &&
      dto.maxAmount !== undefined &&
      dto.minAmount > dto.maxAmount
    ) {
      throw new BadRequestException('The minimum cannot be more than the maximum.');
    }
  }
}
