import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  EnforcementReason,
  EnforcementStatus,
  EntityStatus,
  EntityType,
  Prisma,
  ReportingFrequency,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { entityScopeFilter } from '../common/utils/data-scope.util';
import { graceEndsAt, periodPhase } from '../common/utils/period-timeline.util';
import { assessPenalty } from './penalty-assessment';
import { PenaltyScheduleService } from './penalty-schedule.service';
import { EnforcementQueryDto } from './dto/enforcement-query.dto';
import { ResolveCaseDto } from './dto/resolve-case.dto';

/**
 * Row shape returned to clients: the case plus the names needed to read it.
 *
 * Operators can read their own cases, so `resolvedBy` carries the officer's name and nothing more.
 * An operator should be able to see who closed the case against them; they have no need for that
 * officer's email address or internal role, and this list is the one place Authority staff details
 * would otherwise cross to an external account.
 */
/**
 * Everything `assessPenalty` reads from a schedule line.
 *
 * Named once and shared, because a select that quietly omits a term does not fail — it prices the
 * case as though the term were not there.
 */
/**
 * The statutory remedy period, in days (NCA, 3 September 2026).
 *
 * The Act requires thirty days' notice before any financial penalty. NCA set out exactly how that
 * meets the accrual, and the wording is worth keeping because the two obvious readings give very
 * different sums on a long default:
 *
 *   "From the original late date (after the grace window), but only assessed once the 30-day
 *    remedy period lapses unremedied. So nothing is payable during the 30 days, but a defaulter
 *    doesn't get a free month either."
 *
 * So the notice gates **assessment**, not accrual. The figure is still calculated from the day the
 * return was genuinely late; it simply is not payable until the operator has had their thirty days
 * and not used them.
 */
export const REMEDY_PERIOD_DAYS = 30;

/** Thirty days after the notice went out. */
function remedyDueFrom(noticeAt: Date): Date {
  return new Date(noticeAt.getTime() + REMEDY_PERIOD_DAYS * 86_400_000);
}

const penaltyTermsSelect = {
  fixedAmount: true,
  dailyAmount: true,
  maxAmount: true,
  minAmount: true,
  percentOfRevenue: true,
} satisfies Prisma.PenaltyRuleSelect;

const caseSelect = {
  id: true,
  reason: true,
  status: true,
  note: true,
  openedAt: true,
  resolvedAt: true,
  resolutionNote: true,
  createdAt: true,
  penaltyAmount: true,
  penaltyDays: true,
  penaltyAssessedAt: true,
  defaultStartedAt: true,
  defaultEndedAt: true,
  remedyNoticeAt: true,
  remedyDueAt: true,
  entity: { select: { id: true, name: true, type: true } },
  period: { select: { id: true, label: true, frequency: true, dueDate: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
  // The line the amount was priced under, so an operator can be told why it owes what it owes.
  penaltyRule: { select: { id: true, label: true, ...penaltyTermsSelect } },
} satisfies Prisma.EnforcementCaseSelect;

/**
 * The deadline / enforcement engine (Q3). Its sweep evaluates a reporting period once its grace
 * window has ended (or it has been closed) and opens a compliance case against every entity that
 * was expected to file but did not. Cases are then worked by the Authority (resolve / waive). The
 * Phase 2 added the sanction on top of the flag. The penalty schedule is configuration entered by
 * an administrator (Q3), the engine prices a case under the line in force when the default began,
 * accrues any daily component while the default continues, and closes the case by itself the moment
 * the missing return arrives. Nothing here decides what a contravention is worth.
 */
@Injectable()
export class EnforcementService {
  private readonly logger = new Logger(EnforcementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly schedule: PenaltyScheduleService,
  ) {}

  // --- Read + case management (Authority + scoped operators) ----------------

  async findAll(user: AuthUser, query: EnforcementQueryDto) {
    // Operators are forced to their own entity; Authority may filter by any (or none).
    const scoped = entityScopeFilter(user);
    const where: Prisma.EnforcementCaseWhereInput = {
      entityId: scoped ?? query.entityId,
      periodId: query.periodId,
      status: query.status,
      reason: query.reason,
    };
    const orderBy = { [query.sort]: query.order } as Prisma.EnforcementCaseOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.enforcementCase.findMany({ where, select: caseSelect, orderBy, skip, take }),
      this.prisma.enforcementCase.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async resolve(user: AuthUser, id: string, dto: ResolveCaseDto, ctx: RequestContext) {
    return this.close(user, id, EnforcementStatus.RESOLVED, dto.note, ctx);
  }

  async waive(user: AuthUser, id: string, dto: ResolveCaseDto, ctx: RequestContext) {
    return this.close(user, id, EnforcementStatus.WAIVED, dto.note, ctx);
  }

  private async close(
    user: AuthUser,
    id: string,
    status: EnforcementStatus,
    note: string | undefined,
    ctx: RequestContext,
  ) {
    const existing = await this.prisma.enforcementCase.findUnique({
      where: { id },
      select: { id: true, status: true, entityId: true, period: { select: { label: true } } },
    });
    if (!existing) throw new NotFoundException('Enforcement case not found');
    if (existing.status !== EnforcementStatus.OPEN) {
      throw new BadRequestException('This case has already been closed.');
    }
    const updated = await this.prisma.enforcementCase.update({
      where: { id },
      data: {
        status,
        resolutionNote: note?.trim() || null,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
      select: caseSelect,
    });
    await this.record(
      status === EnforcementStatus.RESOLVED
        ? AuditAction.ENFORCEMENT_CASE_RESOLVED
        : AuditAction.ENFORCEMENT_CASE_WAIVED,
      id,
      user.id,
      ctx,
      { note: note?.trim() || undefined },
    );
    // Let the entity's operators know the case against them has been closed (best-effort).
    await this.notifications.enforcementCaseClosed({
      entityId: existing.entityId,
      periodLabel: existing.period.label,
      waived: status === EnforcementStatus.WAIVED,
    });
    return updated;
  }

  // --- The deadline sweep ---------------------------------------------------

  /** Sweep every period whose grace window has ended (or that has been closed). */
  /** `actorId` is null when the scheduler runs this rather than a person. */
  async sweepDue(actorId: string | null, ctx: RequestContext) {
    const periods = await this.prisma.reportingPeriod.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let periodsSwept = 0;
    let casesOpened = 0;
    let periodsFailed = 0;
    for (const p of periods) {
      // A period that cannot be swept is logged and stepped over. The alternative is that one bad
      // period stops the nightly run, and every other operator's missed deadline goes unrecorded
      // until somebody notices — which is exactly the failure this engine exists to prevent.
      try {
        const result = await this.sweepPeriod(p.id, actorId, ctx);
        if (!result.skipped) {
          periodsSwept += 1;
          casesOpened += result.opened;
        }
      } catch (error) {
        periodsFailed += 1;
        this.logger.error(`Could not sweep period ${p.id}`, error as Error);
      }
    }
    return { periodsSwept, casesOpened, periodsFailed };
  }

  /**
   * Evaluate one period: if its grace window has ended (or it is closed), open a MISSED_DEADLINE
   * case for every ACTIVE entity that the period's template applies to but which never filed.
   * Idempotent — a re-run never opens a second case for the same (entity, period).
   */
  async sweepPeriod(
    periodId: string,
    actorId: string | null,
    ctx: RequestContext,
  ): Promise<{ skipped: boolean; opened: number; expected?: number }> {
    const period = await this.prisma.reportingPeriod.findFirst({
      where: { id: periodId, deletedAt: null },
      select: {
        id: true,
        label: true,
        status: true,
        dueDate: true,
        graceDays: true,
        template: {
          select: { sections: { select: { applicableEntityTypes: true } } },
        },
      },
    });
    if (!period) return { skipped: true, opened: 0 };

    // Only sweep once the compliance signal is real: grace has ended, or the period is closed.
    const phase = periodPhase(period.status, period.dueDate, period.graceDays);
    if (phase !== 'overdue' && phase !== 'closed') return { skipped: true, opened: 0 };

    // Which entity types the period's template applies to (union of its sections).
    const types = new Set<EntityType>();
    for (const section of period.template.sections) {
      for (const t of section.applicableEntityTypes) types.add(t);
    }
    if (types.size === 0) return { skipped: false, opened: 0, expected: 0 };

    // Entities expected to file: ACTIVE, of an applicable type.
    const expected = await this.prisma.entity.findMany({
      where: { status: EntityStatus.ACTIVE, deletedAt: null, type: { in: [...types] } },
      select: { id: true, name: true, type: true },
    });

    // Who actually filed (any non-draft return that was submitted, still live).
    const filed = await this.prisma.submission.findMany({
      where: { periodId, submittedAt: { not: null }, deletedAt: null },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    const filedIds = new Set(filed.map((f) => f.entityId));

    let opened = 0;
    for (const entity of expected) {
      if (filedIds.has(entity.id)) continue;
      // Skip if a case (in any state) already exists — don't reopen a resolved/waived one.
      const already = await this.prisma.enforcementCase.findUnique({
        where: {
          entityId_periodId_reason: {
            entityId: entity.id,
            periodId,
            reason: EnforcementReason.MISSED_DEADLINE,
          },
        },
        select: { id: true },
      });
      if (already) continue;

      // The contravention begins when the grace window closes, not when the sweep happens to run.
      // A sweep that is late must not shorten the penalty an operator has actually incurred.
      const startedAt = graceEndsAt(period.dueDate, period.graceDays);
      const priced = await this.priceCase(entity.type, entity.id, startedAt, null);

      // The `findUnique` above is a cheap first pass, not a lock. Two sweeps running at once (two
      // instances, or an administrator pressing the button while the nightly job runs) both see no
      // case and both try to create one. The unique index is what actually makes this idempotent;
      // losing that race means the case already exists, which is the outcome we wanted anyway.
      let created: { id: string };
      try {
        /*
         * Opening the case issues the remedy notice, and the amount is held back until it lapses.
         *
         * The penalty is still *calculated* from `defaultStartedAt`, the day the return was
         * genuinely late — the operator does not get a free month. What waits is the figure
         * becoming payable, which is what the Act's thirty days' notice protects.
         *
         * `penaltyAssessedAt` therefore stays null here even when the line prices cleanly. It is
         * set by the accrual once the notice has run out with the return still missing.
         */
        const noticeAt = new Date();
        created = await this.prisma.enforcementCase.create({
          data: {
            entityId: entity.id,
            periodId,
            reason: EnforcementReason.MISSED_DEADLINE,
            note: `No return filed for ${period.label} by the end of the grace period.`,
            defaultStartedAt: startedAt,
            remedyNoticeAt: noticeAt,
            remedyDueAt: remedyDueFrom(noticeAt),
            penaltyRuleId: priced?.ruleId ?? null,
            /*
             * A percentage line whose audited revenue is not in yet has no amount — not an amount
             * of zero. Writing the zero would put a figure on the case that reads as "nothing to
             * pay", which is the opposite of what it means, and nothing later would correct it.
             */
            penaltyAmount: priced && !priced.pending ? new Prisma.Decimal(priced.amount) : null,
            penaltyDays: priced?.days ?? 0,
            penaltyAssessedAt: null,
          },
          select: { id: true },
        });
      } catch (error) {
        // P2002: another sweep won the race and the case already exists, which is the outcome we
        // wanted. P2003/P2025: the entity or period was removed between the read and the write.
        // Neither is a reason to abandon the rest of the sweep and leave real contraventions
        // unrecorded, so the row is skipped and the run carries on.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2003', 'P2025'].includes(error.code)
        ) {
          continue;
        }
        throw error;
      }
      opened += 1;
      if (priced) {
        await this.record(AuditAction.ENFORCEMENT_PENALTY_ASSESSED, periodId, actorId, ctx, {
          caseId: created.id,
          entityId: entity.id,
          ruleId: priced.ruleId,
          amount: priced.amount,
          days: priced.days,
        });
      }
      await this.record(AuditAction.ENFORCEMENT_CASE_OPENED, periodId, actorId, ctx, {
        entityId: entity.id,
        reason: EnforcementReason.MISSED_DEADLINE,
      });
      await this.notifications.enforcementCaseOpened({
        entityId: entity.id,
        entityName: entity.name,
        periodLabel: period.label,
      });
    }
    if (opened > 0) this.logger.log(`Opened ${opened} enforcement case(s) for period ${periodId}`);
    return { skipped: false, opened, expected: expected.length };
  }

  // --- Penalty automation (Phase 2) ----------------------------------------

  /**
   * What a case is worth, under the schedule line in force when the default began.
   *
   * Returns null when NCA has no schedule line covering the contravention. That is a legitimate
   * state, not an error: the case is still opened and still worked, it simply carries no amount
   * until Legal and Licensing have entered the figures. An engine that refused to record a
   * contravention because nobody had priced it yet would lose the contravention.
   */
  private async priceCase(
    entityType: EntityType,
    entityId: string,
    startedAt: Date,
    endedAt: Date | null,
  ) {
    const rule = await this.schedule.ruleFor(
      EnforcementReason.MISSED_DEADLINE,
      entityType,
      startedAt,
    );
    if (!rule) return null;
    const now = new Date();
    // Only a percentage line consults revenue, so only a percentage line pays for the lookup.
    const revenue =
      rule.percentOfRevenue == null ? null : await this.auditedAnnualRevenue(entityId, now);
    const assessment = assessPenalty(
      PenaltyScheduleService.toTerms(rule),
      startedAt,
      endedAt,
      now,
      revenue,
    );
    return { ruleId: rule.id, ...assessment };
  }

  /**
   * The operator's audited annual revenue, for a schedule line priced as a share of it.
   *
   * Tiers 2 and 3 of NCA's schedule are stated as a percentage of audited annual revenue, and
   * VALIDATION_SPEC §4.1 is explicit that the annual return carries that figure from audited
   * accounts rather than a sum of the quarters — so the annual return is the only honest place to
   * read it from. Which fields make up "revenue" is the same question the levy asks, and it is
   * answered the same way: the fields an administrator flagged as the levy basis. A penalty and a
   * levy assessed on different money would be indefensible the first time an operator compared them.
   *
   * Null when no annual return has been approved yet — the ordinary case for a contravention early
   * in the year. The caller records that as "not yet assessable", never as zero.
   */
  private async auditedAnnualRevenue(entityId: string, asOf: Date): Promise<number | null> {
    const annual = await this.prisma.submission.findFirst({
      where: {
        entityId,
        status: SubmissionStatus.APPROVED,
        deletedAt: null,
        supersededBy: null,
        period: {
          frequency: ReportingFrequency.ANNUAL,
          deletedAt: null,
          dueDate: { lte: asOf },
        },
      },
      orderBy: { period: { dueDate: 'desc' } },
      select: {
        values: {
          where: { isUnavailable: false, field: { isLevyBasis: true } },
          select: { valueText: true },
        },
      },
    });
    if (!annual || annual.values.length === 0) return null;
    return annual.values.reduce((sum, v) => sum + (Number(v.valueText) || 0), 0);
  }

  /**
   * Bring open cases up to date: accrue the daily component, and close any case whose missing
   * return has since arrived.
   *
   * Run nightly by the scheduler. It is deliberately idempotent and safe to run at any hour: every
   * figure is recomputed from the case's own start date and the schedule line already recorded on
   * it, so running twice in a day changes nothing, and missing a night costs nothing either.
   *
   * Closed cases are never touched. Once a case is resolved or waived, the amount on it is the
   * amount that was assessed, and no later run may revise it.
   */
  async accrue(actorId: string | null, ctx: RequestContext) {
    const open = await this.prisma.enforcementCase.findMany({
      where: { status: EnforcementStatus.OPEN, defaultStartedAt: { not: null } },
      select: {
        id: true,
        entityId: true,
        periodId: true,
        penaltyAmount: true,
        penaltyDays: true,
        defaultStartedAt: true,
        remedyDueAt: true,
        period: { select: { label: true } },
        // Every field the arithmetic reads. Selecting three of them is how a percentage line
        // silently became a zero.
        penaltyRule: { select: penaltyTermsSelect },
      },
    });
    if (open.length === 0) return { cases: 0, accrued: 0, closed: 0 };

    // One query for every filing that could close a case, rather than one query per case.
    const filings = await this.prisma.submission.findMany({
      where: {
        deletedAt: null,
        submittedAt: { not: null },
        OR: open.map((c) => ({ entityId: c.entityId, periodId: c.periodId })),
      },
      select: { entityId: true, periodId: true, submittedAt: true },
      orderBy: { submittedAt: 'asc' },
    });
    const arrivedAt = new Map<string, Date>();
    for (const f of filings) {
      const key = `${f.entityId}::${f.periodId}`;
      // The first filing is what ended the default; a later revision does not restart it.
      if (!arrivedAt.has(key) && f.submittedAt) arrivedAt.set(key, f.submittedAt);
    }

    let accrued = 0;
    let closed = 0;
    const now = new Date();

    for (const c of open) {
      const endedAt = arrivedAt.get(`${c.entityId}::${c.periodId}`) ?? null;
      /*
       * The same mapping the sweep uses, rather than the three fields rebuilt by hand here.
       *
       * They were rebuilt, and once the schedule gained a percentage tier that mattered: a line
       * priced as a share of revenue would have arrived here with its percentage stripped, fallen
       * through to the fixed-and-daily arithmetic, and accrued **zero** — a wrong figure presented
       * as a real one, which is worse than none. Two places deciding what a schedule line means is
       * the defect; one mapping is the fix.
       */
      // A percentage line is priced on audited annual revenue; a fixed-and-daily line never reads
      // it, so the lookup only runs where it can change the answer.
      const isRevenueShare = (c.penaltyRule?.percentOfRevenue ?? null) !== null;
      const revenue = isRevenueShare ? await this.auditedAnnualRevenue(c.entityId, now) : null;
      const assessment = c.penaltyRule
        ? assessPenalty(
            PenaltyScheduleService.toTerms(c.penaltyRule),
            c.defaultStartedAt!,
            endedAt,
            now,
            revenue,
          )
        : null;

      /*
       * Has the operator had their thirty days, and not used them?
       *
       * This decides whether the figure is *payable*, not what it is. A case opened without a
       * notice date is one from before this existed; treating it as still within its remedy period
       * would freeze it for ever, so an absent date reads as "the period has passed".
       */
      const remedyLapsed = c.remedyDueAt === null || c.remedyDueAt <= now;

      if (endedAt) {
        /*
         * The return arrived. Close the case, with the amount frozen at what had accrued by the day
         * it came in rather than by the day the job happened to notice.
         *
         * If it arrived inside the remedy period, NCA's rule is that "only the Tier 1 late charge
         * stands" — the operator remedied when asked. A per-day line is a Tier 1 late charge and
         * still applies; a percentage of revenue is a Tier 2 or 3 sanction and does not, because
         * the notice was answered.
         */
        const curedInTime = !remedyLapsed;
        // An amount still awaiting audited revenue is not payable either — it is not yet a figure.
        const payable =
          assessment && !assessment.pending && !(curedInTime && isRevenueShare) ? assessment : null;
        await this.prisma.enforcementCase.update({
          where: { id: c.id },
          data: {
            status: EnforcementStatus.RESOLVED,
            defaultEndedAt: endedAt,
            resolvedAt: now,
            resolutionNote: curedInTime
              ? `Closed automatically: the return for ${c.period.label} was filed within the remedy period.`
              : `Closed automatically: the return for ${c.period.label} was filed.`,
            penaltyAmount: payable ? new Prisma.Decimal(payable.amount) : undefined,
            penaltyDays: assessment?.days,
            penaltyAssessedAt: payable ? now : undefined,
          },
        });
        closed += 1;
        await this.record(AuditAction.ENFORCEMENT_CASE_RESOLVED, c.periodId, actorId, ctx, {
          caseId: c.id,
          entityId: c.entityId,
          automatic: true,
          penaltyAmount: payable?.amount,
          curedWithinRemedyPeriod: curedInTime,
        });
        await this.notifications.enforcementCaseClosed({
          entityId: c.entityId,
          periodLabel: c.period.label,
          waived: false,
        });
        continue;
      }

      // Nothing to write for a line that still has no figure, or one that has not moved.
      if (!assessment || assessment.pending) continue;
      if (Number(c.penaltyAmount ?? 0) === assessment.amount) continue;

      /*
       * The return is still missing. Keep the running figure up to date either way, but only stamp
       * `penaltyAssessedAt` once the remedy period has lapsed.
       *
       * That stamp is what makes the amount payable, and it is the whole of the Act's protection
       * here: during the thirty days the case shows what is accruing and nothing is due. Leaving
       * the amount unchanged instead would be the other reading of NCA's answer, and they ruled it
       * out — "a defaulter doesn't get a free month either".
       */
      await this.prisma.enforcementCase.update({
        where: { id: c.id },
        data: {
          penaltyAmount: new Prisma.Decimal(assessment.amount),
          penaltyDays: assessment.days,
          penaltyAssessedAt: remedyLapsed ? now : null,
        },
      });
      accrued += 1;
      await this.record(AuditAction.ENFORCEMENT_PENALTY_ASSESSED, c.periodId, actorId, ctx, {
        caseId: c.id,
        entityId: c.entityId,
        amount: assessment.amount,
        days: assessment.days,
        capped: assessment.capped,
        payableNow: remedyLapsed,
      });
    }

    if (closed > 0 || accrued > 0) {
      this.logger.log(`Penalty run: ${accrued} case(s) accrued, ${closed} closed automatically`);
    }
    return { cases: open.length, accrued, closed };
  }

  private record(
    action: AuditAction,
    periodId: string,
    actorId: string | null,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'EnforcementCase',
      entityId: periodId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
