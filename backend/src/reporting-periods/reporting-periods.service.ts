import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, PeriodStatus, Prisma, TemplateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { graceEndsAt, periodPhase, type PeriodPhase } from '../common/utils/period-timeline.util';
import { EnforcementService } from '../enforcement/enforcement.service';
import { CreatePeriodDto, PeriodQueryDto, UpdatePeriodDto } from './dto/period.dto';
import { periodSelect } from './reporting-periods.constants';

type PeriodRow = Prisma.ReportingPeriodGetPayload<{ select: typeof periodSelect }>;

export type { PeriodPhase };

@Injectable()
export class ReportingPeriodsService {
  private readonly logger = new Logger(ReportingPeriodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly enforcement: EnforcementService,
  ) {}

  /** Attach the computed deadline timeline (grace end + phase) to a period. */
  private withTimeline(period: PeriodRow, now = new Date()) {
    return {
      ...period,
      timeline: {
        dueDate: period.dueDate,
        graceEndsAt: graceEndsAt(period.dueDate, period.graceDays),
        phase: periodPhase(period.status, period.dueDate, period.graceDays, now),
      },
    };
  }

  async findAll(query: PeriodQueryDto) {
    const where: Prisma.ReportingPeriodWhereInput = {
      deletedAt: null,
      templateId: query.templateId,
      status: query.status,
      frequency: query.frequency,
      ...(query.search ? { label: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const orderBy = { [query.sort]: query.order } as Prisma.ReportingPeriodOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reportingPeriod.findMany({ where, select: periodSelect, orderBy, skip, take }),
      this.prisma.reportingPeriod.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.withTimeline(r)),
      total,
      query,
    );
  }

  async findOne(id: string) {
    const period = await this.prisma.reportingPeriod.findFirst({
      where: { id, deletedAt: null },
      select: periodSelect,
    });
    if (!period) throw new NotFoundException('Reporting period not found');
    return this.withTimeline(period);
  }

  async create(dto: CreatePeriodDto, actorId: string, ctx: RequestContext) {
    // A period can only be opened against a published template.
    const template = await this.prisma.reportingTemplate.findFirst({
      where: { id: dto.templateId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!template) throw new BadRequestException('Template not found');
    if (template.status !== TemplateStatus.PUBLISHED) {
      throw new BadRequestException('You can only open a period against a published template.');
    }

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    const dueDate = new Date(dto.dueDate);
    if (!(periodStart <= periodEnd && periodEnd <= dueDate)) {
      throw new BadRequestException(
        'The start date must be on or before the end date, and the end date on or before the due date.',
      );
    }

    const status = dto.status ?? PeriodStatus.OPEN;
    const period = await this.prisma.reportingPeriod.create({
      data: {
        templateId: dto.templateId,
        frequency: dto.frequency,
        label: dto.label.trim(),
        periodStart,
        periodEnd,
        dueDate,
        graceDays: dto.graceDays ?? 5,
        status,
        openedAt: status === PeriodStatus.OPEN ? new Date() : null,
      },
      select: periodSelect,
    });
    await this.record(AuditAction.PERIOD_CREATED, period.id, actorId, ctx, {
      templateId: dto.templateId,
      label: period.label,
      status,
    });
    return this.withTimeline(period);
  }

  async update(id: string, dto: UpdatePeriodDto, actorId: string, ctx: RequestContext) {
    const before = await this.findOne(id);
    const periodStart = dto.periodStart ? new Date(dto.periodStart) : before.periodStart;
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : before.periodEnd;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : before.dueDate;
    if (!(periodStart <= periodEnd && periodEnd <= dueDate)) {
      throw new BadRequestException(
        'The start date must be on or before the end date, and the end date on or before the due date.',
      );
    }
    const period = await this.prisma.reportingPeriod.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        periodStart: dto.periodStart ? periodStart : undefined,
        periodEnd: dto.periodEnd ? periodEnd : undefined,
        dueDate: dto.dueDate ? dueDate : undefined,
        graceDays: dto.graceDays,
      },
      select: periodSelect,
    });
    await this.record(AuditAction.PERIOD_UPDATED, id, actorId, ctx, { changes: { ...dto } });
    return this.withTimeline(period);
  }

  /** Open (or re-open) a period for submissions. */
  async open(id: string, actorId: string, ctx: RequestContext) {
    const current = await this.findOne(id);
    const period = await this.prisma.reportingPeriod.update({
      where: { id },
      data: { status: PeriodStatus.OPEN, openedAt: current.openedAt ?? new Date() },
      select: periodSelect,
    });
    await this.record(AuditAction.PERIOD_OPENED, id, actorId, ctx);
    return this.withTimeline(period);
  }

  async close(id: string, actorId: string, ctx: RequestContext) {
    await this.findOne(id);
    const period = await this.prisma.reportingPeriod.update({
      where: { id },
      data: { status: PeriodStatus.CLOSED, closedAt: new Date() },
      select: periodSelect,
    });
    await this.record(AuditAction.PERIOD_CLOSED, id, actorId, ctx);
    // Closing a period settles compliance: open cases for anyone who never filed. Best-effort —
    // a sweep failure must not undo the close itself.
    try {
      await this.enforcement.sweepPeriod(id, actorId, ctx);
    } catch (err) {
      this.logger.error(`Compliance sweep after closing period ${id} failed`, err as Error);
    }
    return this.withTimeline(period);
  }

  /**
   * Soft-delete: periods are retained for audit/history.
   *
   * A period with returns against it cannot be deleted. Deleting it would strand them: the guard
   * that decides whether a draft is editable reads `period.status`, so an operator could carry on
   * editing and submitting into a period the Authority believes is gone, and the return would then
   * reach a reviewer's queue attached to it. Close the period instead: that is what ends filing.
   */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    const period = await this.findOne(id);
    const returns = await this.prisma.submission.count({
      where: { periodId: id, deletedAt: null },
    });
    if (returns > 0) {
      throw new BadRequestException(
        `${returns} ${returns === 1 ? 'return has' : 'returns have'} been started for this period, so it can't be deleted. Close it instead.`,
      );
    }
    await this.prisma.reportingPeriod.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(AuditAction.PERIOD_DELETED, id, actorId, ctx, { label: period.label });
    return { message: 'Reporting period deleted' };
  }

  private record(
    action: AuditAction,
    periodId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'ReportingPeriod',
      entityId: periodId,
      metadata,
      context: ctx,
    });
  }
}
