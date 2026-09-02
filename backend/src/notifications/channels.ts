import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { MailConfig } from '../config/configuration';
import { MailService } from '../mail/mail.service';
import { SMS_PROVIDER, SmsProvider, SmsSendResult } from './sms/sms-provider';

/** DI token for the set of external channels the dispatcher fans a notification out to. */
export const NOTIFICATION_CHANNELS = 'NOTIFICATION_CHANNELS';

/** The recipient-facing content of one notification, handed to every channel. */
export interface NotificationMessage {
  recipient: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    /** E.164, or null. Only ever set once confirmed. */
    phone?: string | null;
    phoneVerifiedAt?: Date | null;
  };
  /** Which kind of notification this is. The SMS channel uses it to decide whether to send. */
  type?: NotificationType;
  title: string;
  body: string;
  /** Relative in-app link (e.g. /submissions/:id); a channel turns it into an absolute URL. */
  linkPath?: string | null;
}

/**
 * An out-of-app delivery channel (email, SMS, …). The portal is deliberately not tied to any one
 * provider (Q8): the dispatcher talks to this interface, and a new vendor is a new implementation,
 * not a change to callers. `send` throws on failure so the dispatcher can record and retry it.
 */
export interface NotificationChannel {
  readonly name: 'email' | 'sms';
  isEnabled(): boolean;
  send(message: NotificationMessage): Promise<SmsSendResult | void>;
}

/** Turn a relative in-app path into an absolute URL using the configured frontend origin. */
function toAbsoluteUrl(loginUrl: string, linkPath?: string | null): string | undefined {
  if (!linkPath) return undefined;
  try {
    return new URL(linkPath, new URL(loginUrl).origin).toString();
  } catch {
    return undefined;
  }
}

/** Email delivery, via the shared branded MailService/SendGrid (console fallback in demo). */
@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  readonly name = 'email' as const;
  private readonly loginUrl: string;

  constructor(
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.loginUrl = config.get<MailConfig>('mail')!.loginUrl;
  }

  isEnabled(): boolean {
    return true;
  }

  async send(message: NotificationMessage): Promise<void> {
    await this.mail.sendNotification({
      to: message.recipient.email,
      firstName: message.recipient.firstName,
      lastName: message.recipient.lastName,
      title: message.title,
      body: message.body,
      actionUrl: toAbsoluteUrl(this.loginUrl, message.linkPath),
      actionLabel: 'Open in the portal',
    });
  }
}

/**
 * Which notifications are worth a text message.
 *
 * Not all of them. Every SMS costs the Authority money and interrupts somebody, and a channel used
 * for everything is a channel people learn to ignore — at which point it stops working for the one
 * message that mattered. The test applied here is whether the recipient has to *do* something, or
 * whether something is happening to them whether they act or not:
 *
 * - **A return sent back** — the deadline is still running and they have to fix and resubmit.
 * - **A compliance case opened** — they are already non-compliant, and penalties may be accruing.
 * - **A licence expiring or expired** — a lapsed licence is not a paperwork problem.
 *
 * Deliberately absent: a return being approved (good news, nothing to do), a return reaching a
 * reviewer (internal), a citizen complaint arriving (internal, and the Authority is at its desks).
 * Those still arrive in the portal and by email.
 *
 * This is a policy judgement rather than a technical one, and NCA may want it different. It is a
 * constant so that changing it is a deliberate edit with this reasoning next to it.
 */
export const SMS_WORTHY: ReadonlySet<NotificationType> = new Set([
  NotificationType.RETURN_REJECTED,
  NotificationType.ENFORCEMENT_CASE_OPENED,
  NotificationType.DOCUMENT_EXPIRING,
  NotificationType.DOCUMENT_EXPIRED,
]);

/** A GSM-7 message is 160 characters; past that the gateway bills for a second one. */
const SMS_MAX_LENGTH = 160;

/**
 * Fit the notification into one message.
 *
 * The title carries the substance ("Your return needs changes"), so it goes first and whole. The
 * body is added only if there is room, and is cut at a word rather than mid-syllable.
 */
export function composeSms(title: string, body: string): string {
  const full = `NCA Portal: ${title}. ${body}`.replace(/\s+/g, ' ').trim();
  if (full.length <= SMS_MAX_LENGTH) return full;

  const cut = full.slice(0, SMS_MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > SMS_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * SMS delivery, through whichever gateway is configured.
 *
 * Two conditions are checked before anything is sent, and both are refusals rather than fallbacks:
 * the notification has to be one of the few worth a text message, and the recipient's number has
 * to have been **confirmed**. Texting an unconfirmed number sends the Authority's business to
 * whoever actually holds it, and nothing about that failure is visible from inside the portal.
 */
@Injectable()
export class SmsNotificationChannel implements NotificationChannel {
  readonly name = 'sms' as const;
  private readonly logger = new Logger(SmsNotificationChannel.name);

  constructor(@Inject(SMS_PROVIDER) private readonly provider: SmsProvider) {}

  isEnabled(): boolean {
    return this.provider.isConfigured();
  }

  /** Whether this particular message should go out by SMS at all. */
  appliesTo(message: NotificationMessage): boolean {
    if (!message.type || !SMS_WORTHY.has(message.type)) return false;
    return Boolean(message.recipient.phone && message.recipient.phoneVerifiedAt);
  }

  async send(message: NotificationMessage): Promise<SmsSendResult | void> {
    if (!this.appliesTo(message)) {
      this.logger.debug(`No SMS for notification to ${message.recipient.id}.`);
      return;
    }
    return this.provider.send(
      message.recipient.phone as string,
      composeSms(message.title, message.body),
    );
  }
}
