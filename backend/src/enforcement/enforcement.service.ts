import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  EnforcementReason,
  EnforcementStatus,
  EntityStatus,
  EntityType,
  Prisma,
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
  entity: { select: { id: true, name: true, type: true } },
  period: { select: { id: true, label: true, frequency: true, dueDate: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
  // The line the amount was priced under, so an operator can be told why it owes what it owes.
  penaltyRule: {
    select: { id: true, label: true, fixedAmount: true, dailyAmount: true, maxAmount: true },
  },
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
      const priced = await this.priceCase(entity.type, startedAt, null);

      // The `findUnique` above is a cheap first pass, not a lock. Two sweeps running at once (two
      // instances, or an administrator pressing the button while the nightly job runs) both see no
      // case and both try to create one. The unique index is what actually makes this idempotent;
      // losing that race means the case already exists, which is the outcome we wanted anyway.
      let created: { id: string };
      try {
        created = await this.prisma.enforcementCase.create({
          data: {
            entityId: entity.id,
            periodId,
            reason: EnforcementReason.MISSED_DEADLINE,
            note: `No return filed for ${period.label} by the end of the grace period.`,
            defaultStartedAt: startedAt,
            penaltyRuleId: priced?.ruleId ?? null,
            penaltyAmount: priced ? new Prisma.Decimal(priced.amount) : null,
            penaltyDays: priced?.days ?? 0,
            penaltyAssessedAt: priced ? new Date() : null,
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
  private async priceCase(entityType: EntityType, startedAt: Date, endedAt: Date | null) {
    const rule = await this.schedule.ruleFor(
      EnforcementReason.MISSED_DEADLINE,
      entityType,
      startedAt,
    );
    if (!rule) return null;
    const assessment = assessPenalty(
      PenaltyScheduleService.toTerms(rule),
      startedAt,
      endedAt,
      new Date(),
    );
    return { ruleId: rule.id, ...assessment };
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
        period: { select: { label: true } },
        penaltyRule: { select: { fixedAmount: true, dailyAmount: true, maxAmount: true } },
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
      const assessment = c.penaltyRule
        ? assessPenalty(
            {
              fixedAmount: Number(c.penaltyRule.fixedAmount),
              dailyAmount: Number(c.penaltyRule.dailyAmount),
              maxAmount: c.penaltyRule.maxAmount === null ? null : Number(c.penaltyRule.maxAmount),
            },
            c.defaultStartedAt!,
            endedAt,
            now,
          )
        : null;

      if (endedAt) {
        // The return arrived. Close the case, with the amount frozen at what had accrued by the
        // day it came in rather than by the day the job happened to notice.
        await this.prisma.enforcementCase.update({
          where: { id: c.id },
          data: {
            status: EnforcementStatus.RESOLVED,
            defaultEndedAt: endedAt,
            resolvedAt: now,
            resolutionNote: `Closed automatically: the return for ${c.period.label} was filed.`,
            penaltyAmount: assessment ? new Prisma.Decimal(assessment.amount) : undefined,
            penaltyDays: assessment?.days,
            penaltyAssessedAt: assessment ? now : undefined,
          },
        });
        closed += 1;
        await this.record(AuditAction.ENFORCEMENT_CASE_RESOLVED, c.periodId, actorId, ctx, {
          caseId: c.id,
          entityId: c.entityId,
          automatic: true,
          penaltyAmount: assessment?.amount,
        });
        await this.notifications.enforcementCaseClosed({
          entityId: c.entityId,
          periodLabel: c.period.label,
          waived: false,
        });
        continue;
      }

      if (!assessment || Number(c.penaltyAmount ?? 0) === assessment.amount) continue;

      await this.prisma.enforcementCase.update({
        where: { id: c.id },
        data: {
          penaltyAmount: new Prisma.Decimal(assessment.amount),
          penaltyDays: assessment.days,
          penaltyAssessedAt: now,
        },
      });
      accrued += 1;
      await this.record(AuditAction.ENFORCEMENT_PENALTY_ASSESSED, c.periodId, actorId, ctx, {
        caseId: c.id,
        entityId: c.entityId,
        amount: assessment.amount,
        days: assessment.days,
        capped: assessment.capped,
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
