import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, ReportFrequency, Role, ScheduledReportKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { ExportsService } from '../exports/exports.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';
import { isDue } from './report-schedule';
import { CreateReportScheduleDto, UpdateReportScheduleDto } from './dto/report-schedule.dto';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What each kind of report is called, and what it arrives as. */
const REPORTS: Record<
  ScheduledReportKind,
  { title: string; extension: string; contentType: string; summary: string }
> = {
  COMPLIANCE_WORKBOOK: {
    title: 'Sector compliance report',
    extension: 'xlsx',
    contentType: XLSX,
    summary: 'Filing status and timeliness across every licensed operator.',
  },
  LEVY_WORKBOOK: {
    title: 'Levy assessment report',
    extension: 'xlsx',
    contentType: XLSX,
    summary: 'Levy assessed on each operator for the most recent assessed period.',
  },
  LEVY_STATEMENT: {
    title: 'Levy statement',
    extension: 'pdf',
    contentType: 'application/pdf',
    summary: 'Levy assessed on each operator, as a statement.',
  },
};

const scheduleSelect = {
  id: true,
  name: true,
  kind: true,
  frequency: true,
  dayOfPeriod: true,
  hour: true,
  isEnabled: true,
  lastRunAt: true,
  lastError: true,
  createdAt: true,
  recipients: {
    select: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
    },
  },
} satisfies Prisma.ReportScheduleSelect;

/**
 * Reports NCA has asked the portal to build and send on a timetable (Phase 2).
 *
 * The reports themselves are the ones the Authority can already download on demand; nothing new is
 * computed here. What is new is that somebody no longer has to remember to go and fetch them.
 *
 * A scheduled report is built **as the Authority**, over the whole sector, because that is who asked
 * for it and who receives it. Recipients are Authority users chosen from the staff list, so a report
 * cannot be aimed at an address outside the building and a leaver stops receiving it when their
 * account is closed.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly exports: ExportsService,
  ) {}

  list() {
    return this.prisma.reportSchedule.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: scheduleSelect,
    });
  }

  async create(dto: CreateReportScheduleDto, actorId: string, ctx: RequestContext) {
    const recipientIds = await this.resolveRecipients(dto.recipientIds);
    this.assertDay(dto.frequency ?? ReportFrequency.MONTHLY, dto.dayOfPeriod);

    const schedule = await this.prisma.reportSchedule.create({
      data: {
        name: dto.name.trim(),
        kind: dto.kind ?? ScheduledReportKind.COMPLIANCE_WORKBOOK,
        frequency: dto.frequency ?? ReportFrequency.MONTHLY,
        dayOfPeriod: dto.dayOfPeriod ?? 1,
        hour: dto.hour ?? 7,
        isEnabled: dto.isEnabled ?? true,
        createdById: actorId,
        recipients: { create: recipientIds.map((userId) => ({ userId })) },
      },
      select: scheduleSelect,
    });
    await this.record(AuditAction.REPORT_SCHEDULE_CREATED, schedule.id, actorId, ctx, {
      kind: schedule.kind,
      frequency: schedule.frequency,
      recipients: recipientIds.length,
    });
    return schedule;
  }

  async update(id: string, dto: UpdateReportScheduleDto, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.reportSchedule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, frequency: true },
    });
    if (!existing) throw new NotFoundException('That scheduled report does not exist.');

    this.assertDay(dto.frequency ?? existing.frequency, dto.dayOfPeriod);
    const recipientIds =
      dto.recipientIds === undefined ? null : await this.resolveRecipients(dto.recipientIds);

    const schedule = await this.prisma.reportSchedule.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        kind: dto.kind,
        frequency: dto.frequency,
        dayOfPeriod: dto.dayOfPeriod,
        hour: dto.hour,
        isEnabled: dto.isEnabled,
        ...(recipientIds === null
          ? {}
          : {
              // Replace the list outright: an edit that sends a partial list means a name the
              // administrator removed on screen would quietly stay on the distribution.
              recipients: {
                deleteMany: {},
                create: recipientIds.map((userId) => ({ userId })),
              },
            }),
      },
      select: scheduleSelect,
    });
    await this.record(AuditAction.REPORT_SCHEDULE_UPDATED, id, actorId, ctx, {
      changes: { ...dto },
    });
    return schedule;
  }

  async remove(id: string, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.reportSchedule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That scheduled report does not exist.');
    await this.prisma.reportSchedule.update({
      where: { id },
      data: { deletedAt: new Date(), isEnabled: false },
    });
    await this.record(AuditAction.REPORT_SCHEDULE_DELETED, id, actorId, ctx);
    return { message: 'Scheduled report removed' };
  }

  /** Send one report now, whatever its timetable says. Used by the "send now" button. */
  async sendNow(id: string, actorId: string, ctx: RequestContext) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id, deletedAt: null },
      select: scheduleSelect,
    });
    if (!schedule) throw new NotFoundException('That scheduled report does not exist.');
    if (schedule.recipients.length === 0) {
      throw new BadRequestException('Add at least one recipient before sending this report.');
    }
    const sent = await this.send(schedule, actorId, ctx);
    return { sent, recipients: schedule.recipients.length };
  }

  /**
   * Send every report whose window has come round. Run hourly by the scheduler.
   *
   * One schedule failing must not stop the others: a report that cannot be built is recorded on its
   * own row and the run carries on, so a single broken timetable does not take the rest down with
   * it.
   */
  async runDue(actorId: string | null, ctx: RequestContext) {
    const schedules = await this.prisma.reportSchedule.findMany({
      where: { deletedAt: null, isEnabled: true },
      select: scheduleSelect,
    });

    const now = new Date();
    let sent = 0;
    let failed = 0;

    for (const schedule of schedules) {
      if (!isDue(now, schedule, schedule.lastRunAt)) continue;
      if (schedule.recipients.length === 0) continue;
      try {
        await this.send(schedule, actorId, ctx);
        sent += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Could not send "${schedule.name}": ${message}`);
        await this.prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: { lastError: message.slice(0, 500) },
        });
      }
    }

    return { considered: schedules.length, sent, failed };
  }

  /** Build the report and mail it to everyone on the list. */
  private async send(
    schedule: Prisma.ReportScheduleGetPayload<{ select: typeof scheduleSelect }>,
    actorId: string | null,
    ctx: RequestContext,
  ) {
    const meta = REPORTS[schedule.kind];
    const content = await this.build(schedule.kind);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}.${meta.extension}`;

    let delivered = 0;
    for (const recipient of schedule.recipients) {
      await this.mail.sendReport({
        to: recipient.user.email,
        subject: `${schedule.name} (${stamp})`,
        title: schedule.name,
        body: `${meta.summary} The report is attached.`,
        attachment: { filename, content, contentType: meta.contentType },
      });
      delivered += 1;
    }

    await this.prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastError: null },
    });
    await this.record(AuditAction.REPORT_SCHEDULE_SENT, schedule.id, actorId, ctx, {
      kind: schedule.kind,
      recipients: delivered,
    });
    return delivered;
  }

  /**
   * The Authority reader a scheduled report is built as.
   *
   * The exports take an `AuthUser` so they can scope what they return. A scheduled report has no
   * signed-in caller, so it is built as an Authority reader with no entity, which is exactly the
   * scope its recipients already have. There is no path here that could widen anyone's access:
   * every recipient is an Authority user, checked when they were added.
   */
  private authorityReader(): AuthUser {
    return { id: 'scheduled-report', email: '', role: Role.ADMIN, entityId: null };
  }

  private build(kind: ScheduledReportKind): Promise<Buffer> {
    const reader = this.authorityReader();
    switch (kind) {
      case ScheduledReportKind.LEVY_WORKBOOK:
        return this.exports.levyWorkbook(reader, {});
      case ScheduledReportKind.LEVY_STATEMENT:
        return this.exports.levyPdf(reader, {});
      case ScheduledReportKind.COMPLIANCE_WORKBOOK:
      default:
        return this.exports.complianceWorkbook(reader, {});
    }
  }

  /** Recipients must be Authority staff who can still sign in. */
  private async resolveRecipients(ids: string[] | undefined): Promise<string[]> {
    const unique = [...new Set(ids ?? [])];
    if (unique.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: unique },
        deletedAt: null,
        isActive: true,
        role: { in: [...AUTHORITY_ROLES] },
      },
      select: { id: true },
    });
    if (users.length !== unique.length) {
      throw new BadRequestException(
        'Reports can only be sent to active Authority staff. Check the recipients you picked.',
      );
    }
    return users.map((u) => u.id);
  }

  /** A weekly report is set by weekday; a monthly or quarterly one by day of the month. */
  private assertDay(frequency: ReportFrequency, day: number | undefined) {
    if (day === undefined) return;
    if (frequency === ReportFrequency.WEEKLY && (day < 1 || day > 7)) {
      throw new BadRequestException('Choose a day of the week for a weekly report.');
    }
    if (frequency !== ReportFrequency.WEEKLY && (day < 1 || day > 28)) {
      throw new BadRequestException(
        'Choose a day between 1 and 28, so the report has a date in every month.',
      );
    }
  }

  private record(
    action: AuditAction,
    scheduleId: string,
    actorId: string | null,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'ReportSchedule',
      entityId: scheduleId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
