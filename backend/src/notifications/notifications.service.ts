import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationDeliveryStatus,
  NotificationType,
  Prisma,
  ReviewStage,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { MailService } from '../mail/mail.service';
import {
  NOTIFICATION_CHANNELS,
  NotificationChannel,
  NotificationMessage,
  SmsNotificationChannel,
} from './channels';
import { SmsSendResult } from './sms/sms-provider';
import { NotificationQueryDto } from './dto/notification-query.dto';

/** How many times to attempt an external send before marking the delivery failed. */
const MAX_EMAIL_ATTEMPTS = 3;

/** Which reviewer role acts at each stage (mirrors the workflow module). */
const ROLE_FOR_STAGE: Record<ReviewStage, Role> = {
  [ReviewStage.CHECKER]: Role.CHECKER,
  [ReviewStage.VERIFIER]: Role.VERIFIER,
  [ReviewStage.APPROVER]: Role.APPROVER,
};

const OPERATOR_ROLES: Role[] = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER];

/** Who works citizen complaints, and so is told when one arrives. */
const COMPLAINT_HANDLER_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR];

/** The recipient fields a channel needs; also what list rows expose (minus the internal columns). */
const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  linkPath: true,
  submissionId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

/**
 * Everything a delivery channel needs to reach one person.
 *
 * One constant rather than the same object literal in four queries: a channel that gains a field
 * should not be a hunt for every `findMany` that feeds it. Adding SMS is exactly that case.
 */
const recipientSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  phoneVerifiedAt: true,
} satisfies Prisma.UserSelect;

interface Recipient {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  phoneVerifiedAt: Date | null;
}

interface CreateArgs {
  type: NotificationType;
  title: string;
  body: string;
  linkPath?: string;
  submissionId?: string;
  /** Also deliver by the external channels (email/SMS), not just in-app. */
  alsoEmail?: boolean;
}

/**
 * Creates and delivers notifications (Q8). Every notification is stored in-app (the row a user sees
 * in their bell); important ones are also pushed out by email through the channel abstraction, with
 * per-delivery retry state so a transient failure can be retried later. Delivery never throws back
 * into the business flow that triggered it — a failed notification must not undo a submitted return.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
  ) {}

  // --- Domain triggers (called by other modules) ----------------------------

  /** A return has reached a review stage: tell the reviewers who work that stage (in-app). */
  async returnAwaitingReview(args: {
    submissionId: string;
    stage: ReviewStage;
    referenceNumber: string | null;
    entityName: string;
  }): Promise<void> {
    const recipients = await this.reviewersForStage(args.stage);
    const ref = args.referenceNumber ?? 'A return';
    await this.createFor(recipients, {
      type: NotificationType.RETURN_AWAITING_REVIEW,
      title: 'A return is waiting for your review',
      body: `${ref} from ${args.entityName} has reached your review stage.`,
      linkPath: `/submissions/${args.submissionId}`,
      submissionId: args.submissionId,
    });
  }

  /** A return was approved (locked) or rejected: tell the entity's operators (in-app + email). */
  async returnDecision(args: {
    submissionId: string;
    entityId: string;
    approved: boolean;
    referenceNumber: string | null;
    rejectionReason?: string | null;
  }): Promise<void> {
    const recipients = await this.operatorsForEntity(args.entityId);
    const ref = args.referenceNumber ?? 'Your return';
    const content = args.approved
      ? {
          type: NotificationType.RETURN_APPROVED,
          title: 'Your return has been approved',
          body: `${ref} has been reviewed and approved. No further action is needed.`,
        }
      : {
          type: NotificationType.RETURN_REJECTED,
          title: 'Your return needs changes',
          body: args.rejectionReason
            ? `${ref} was sent back for changes. Reason: ${args.rejectionReason}`
            : `${ref} was sent back for changes. Open it to see what to fix and resubmit.`,
        };
    await this.createFor(recipients, {
      ...content,
      linkPath: `/submissions/${args.submissionId}`,
      submissionId: args.submissionId,
      alsoEmail: true,
    });
  }

  /**
   * A compliance case has opened against an entity.
   *
   * Both sides are told. The operator needs to know they are overdue, and the Authority needs to
   * know a case is waiting: the sweep that opens these runs unattended at 02:00, and only ADMIN and
   * SUPERVISOR can resolve or waive a case. Without this they would only find them by opening the
   * Compliance screen on the off-chance.
   */
  async enforcementCaseOpened(args: {
    entityId: string;
    entityName?: string | null;
    periodLabel: string;
  }): Promise<void> {
    const operators = await this.operatorsForEntity(args.entityId);
    await this.createFor(operators, {
      type: NotificationType.ENFORCEMENT_CASE_OPENED,
      title: 'A return is overdue',
      body: `The ${args.periodLabel} return has not been filed and the grace period has ended. A compliance case has been opened. File it as soon as you can.`,
      linkPath: '/submissions',
      alsoEmail: true,
    });

    const handlers = await this.prisma.user.findMany({
      where: { role: { in: COMPLAINT_HANDLER_ROLES }, isActive: true, deletedAt: null },
      select: recipientSelect,
    });
    await this.createFor(handlers, {
      type: NotificationType.ENFORCEMENT_CASE_OPENED,
      title: 'A compliance case has opened',
      body: args.entityName
        ? `${args.entityName} did not file the ${args.periodLabel} return.`
        : `An operator did not file the ${args.periodLabel} return.`,
      linkPath: '/enforcement',
    });
  }

  /** A compliance case was resolved or waived by the Authority: tell the entity's operators. */
  async enforcementCaseClosed(args: {
    entityId: string;
    periodLabel: string;
    waived: boolean;
  }): Promise<void> {
    const recipients = await this.operatorsForEntity(args.entityId);
    await this.createFor(recipients, {
      type: NotificationType.ENFORCEMENT_CASE_CLOSED,
      title: args.waived ? 'A compliance case was waived' : 'A compliance case was closed',
      body: args.waived
        ? `The compliance case for the ${args.periodLabel} return has been waived by the Authority. No further action is needed.`
        : `The compliance case for the ${args.periodLabel} return has been resolved and closed.`,
      linkPath: '/enforcement',
      alsoEmail: true,
    });
  }

  /** A licence or certificate is approaching, or has passed, its expiry date (in-app + email). */
  async documentExpiry(args: {
    entityId: string;
    documentTitle: string;
    expiresOn: string;
    expired: boolean;
  }): Promise<void> {
    const recipients = await this.operatorsForEntity(args.entityId);
    await this.createFor(recipients, {
      type: args.expired ? NotificationType.DOCUMENT_EXPIRED : NotificationType.DOCUMENT_EXPIRING,
      title: args.expired ? 'A document has expired' : 'A document is due to expire',
      body: args.expired
        ? `${args.documentTitle} expired on ${args.expiresOn}. Upload the renewed document to keep your records current.`
        : `${args.documentTitle} expires on ${args.expiresOn}. Upload the renewed document before then.`,
      linkPath: '/documents',
      alsoEmail: true,
    });
  }

  /** A citizen has filed a complaint: tell the Authority so it does not sit unseen (in-app). */
  async complaintReceived(args: {
    referenceNumber: string;
    subject: string;
    aboutEntityName?: string | null;
  }): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: { role: { in: COMPLAINT_HANDLER_ROLES }, isActive: true, deletedAt: null },
      select: recipientSelect,
    });
    await this.createFor(recipients, {
      type: NotificationType.COMPLAINT_RECEIVED,
      title: 'A new complaint has been filed',
      body: args.aboutEntityName
        ? `${args.referenceNumber} about ${args.aboutEntityName}: ${args.subject}`
        : `${args.referenceNumber}: ${args.subject}`,
      linkPath: '/complaints',
    });
  }

  /**
   * A citizen's complaint has moved on. They have no account, so this is email only, and only when
   * they left an address: filing anonymously is allowed and must stay possible.
   */
  async complaintStatusChanged(args: {
    email: string | null;
    referenceNumber: string;
    statusLabel: string;
    note?: string | null;
  }): Promise<void> {
    if (!args.email) return;
    const body = args.note
      ? `Your complaint ${args.referenceNumber} is now ${args.statusLabel}. ${args.note}`
      : `Your complaint ${args.referenceNumber} is now ${args.statusLabel}.`;
    try {
      await this.mail.sendNotification({
        to: args.email,
        title: 'An update on your complaint',
        body,
      });
    } catch (err) {
      // Telling them is best-effort; it must never roll back the Authority's decision.
      this.logger.error(
        `Failed to email the complaint update for ${args.referenceNumber}`,
        err as Error,
      );
    }
  }

  // --- Read API (the recipient's own notifications) -------------------------

  async list(user: AuthUser, query: NotificationQueryDto) {
    const where: Prisma.NotificationWhereInput = {
      recipientId: user.id,
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { recipientId: user.id, readAt: null } }),
    ]);
    return { ...paginate(rows, total, query), unread };
  }

  async unreadCount(user: AuthUser): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { recipientId: user.id, readAt: null },
    });
    return { unread };
  }

  async markRead(user: AuthUser, id: string) {
    // Scope the update to the caller so no one can mark another user's notification read.
    const res = await this.prisma.notification.updateMany({
      where: { id, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      // Either it doesn't exist, isn't theirs, or was already read — treat the last as success.
      const exists = await this.prisma.notification.findFirst({
        where: { id, recipientId: user.id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { message: 'Marked as read' };
  }

  async markAllRead(user: AuthUser) {
    const res = await this.prisma.notification.updateMany({
      where: { recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  // --- Internals ------------------------------------------------------------

  private reviewersForStage(stage: ReviewStage): Promise<Recipient[]> {
    return this.prisma.user.findMany({
      where: { role: ROLE_FOR_STAGE[stage], isActive: true, deletedAt: null },
      select: recipientSelect,
    });
  }

  private operatorsForEntity(entityId: string): Promise<Recipient[]> {
    return this.prisma.user.findMany({
      where: { entityId, role: { in: OPERATOR_ROLES }, isActive: true, deletedAt: null },
      select: recipientSelect,
    });
  }

  /** Persist an in-app notification for each recipient and (optionally) push it to email. */
  private async createFor(recipients: Recipient[], args: CreateArgs): Promise<void> {
    if (recipients.length === 0) return;
    try {
      for (const recipient of recipients) {
        const notification = await this.prisma.notification.create({
          data: {
            recipientId: recipient.id,
            type: args.type,
            title: args.title,
            body: args.body,
            linkPath: args.linkPath,
            submissionId: args.submissionId,
            emailStatus: args.alsoEmail ? NotificationDeliveryStatus.PENDING : null,
          },
          select: { id: true },
        });
        const message = {
          recipient,
          type: args.type,
          title: args.title,
          body: args.body,
          linkPath: args.linkPath,
        };
        if (args.alsoEmail) {
          await this.deliverEmail(notification.id, message);
        }
        // Independent of email: an operator whose licence has expired should hear about it even if
        // the mail provider is having a bad morning.
        await this.deliverSms(notification.id, message);
      }
    } catch (err) {
      // Never let a notification failure break the action that triggered it.
      this.logger.error(`Failed to create notifications (${args.type})`, err as Error);
    }
  }

  /** Attempt the email channel with a small retry, recording the outcome on the notification. */
  private async deliverEmail(notificationId: string, message: NotificationMessage): Promise<void> {
    const channel = this.channels.find((c) => c.name === 'email' && c.isEnabled());
    if (!channel) return;

    let attempts = 0;
    let lastError: string | undefined;
    while (attempts < MAX_EMAIL_ATTEMPTS) {
      attempts += 1;
      try {
        await channel.send(message);
        await this.recordEmail(notificationId, NotificationDeliveryStatus.SENT, attempts);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    this.logger.warn(`Email delivery failed after ${attempts} attempts: ${lastError}`);
    await this.recordEmail(notificationId, NotificationDeliveryStatus.FAILED, attempts, lastError);
  }

  /**
   * Attempt the SMS channel, recording the outcome on the notification.
   *
   * No retry loop, unlike email. A text message that failed because the number is wrong or the
   * balance is spent will fail again a second later, and each attempt costs money. The outcome is
   * recorded and the scheduled retry sweep can pick it up later if NCA wants that; hammering the
   * gateway inside the request is not the way.
   */
  private async deliverSms(notificationId: string, message: NotificationMessage): Promise<void> {
    const channel = this.channels.find((c) => c.name === 'sms' && c.isEnabled());
    if (!channel) return;
    // Most notifications are not worth a text. Asking first keeps `smsStatus` null for those,
    // rather than filling the column with a status that means "we decided not to".
    if (channel instanceof SmsNotificationChannel && !channel.appliesTo(message)) return;

    try {
      const result = await channel.send(message);
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          smsStatus: NotificationDeliveryStatus.SENT,
          smsAttempts: 1,
          smsProviderRef: (result as SmsSendResult | undefined)?.providerRef ?? null,
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SMS delivery failed: ${reason}`);
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          smsStatus: NotificationDeliveryStatus.FAILED,
          smsAttempts: 1,
          smsError: reason.slice(0, 500),
        },
      });
    }
  }

  private async recordEmail(
    id: string,
    status: NotificationDeliveryStatus,
    attempts: number,
    error?: string,
  ): Promise<void> {
    try {
      await this.prisma.notification.update({
        where: { id },
        data: { emailStatus: status, emailAttempts: attempts, emailError: error ?? null },
      });
    } catch (err) {
      this.logger.error('Failed to record email delivery status', err as Error);
    }
  }

  /**
   * Re-attempt notifications whose email delivery failed. Intended to be driven by a scheduler once
   * the deadlines/scheduler module lands; safe to call manually in the meantime.
   */
  async retryFailedEmails(limit = 50): Promise<{ retried: number }> {
    const failed = await this.prisma.notification.findMany({
      where: { emailStatus: NotificationDeliveryStatus.FAILED },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        title: true,
        body: true,
        linkPath: true,
        recipient: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    for (const n of failed) {
      await this.deliverEmail(n.id, {
        recipient: n.recipient,
        title: n.title,
        body: n.body,
        linkPath: n.linkPath,
      });
    }
    return { retried: failed.length };
  }
}
