import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import { MailConfig } from '../config/configuration';
import {
  notificationEmail,
  otpEmail,
  passwordResetEmail,
  welcomeEmail,
  RenderedEmail,
} from './templates';

/**
 * Email delivery via SendGrid. When no API key is configured (local demo),
 * messages are logged to the console so auth flows remain testable offline.
 * All messages use the shared branded template (src/mail/templates).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly enabled: boolean;
  private readonly from: string;
  private readonly fromName: string;
  private readonly loginUrl: string;

  constructor(private readonly config: ConfigService) {
    const mail = this.config.get<MailConfig>('mail')!;
    this.from = mail.from;
    this.fromName = mail.fromName;
    this.loginUrl = mail.loginUrl;
    this.enabled = mail.sendgridApiKey.length > 0;

    if (this.enabled) {
      sgMail.setApiKey(mail.sendgridApiKey);
      this.logger.log('SendGrid email enabled');
    } else {
      this.logger.warn(
        'SENDGRID_API_KEY not set - emails will be logged to the console (demo mode)',
      );
    }
  }

  private get year(): number {
    return new Date().getFullYear();
  }

  async sendPasswordReset(to: string, resetUrl: string, expiresInMinutes: number): Promise<void> {
    await this.send(to, passwordResetEmail({ resetUrl, expiresInMinutes, year: this.year }));
  }

  async sendOtpCode(
    to: string,
    firstName: string,
    lastName: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    await this.send(
      to,
      otpEmail({ firstName, lastName, email: to, code, expiresInMinutes, year: this.year }),
    );
  }

  async sendWelcome(to: string, temporaryPassword: string): Promise<void> {
    await this.send(
      to,
      welcomeEmail({
        email: to,
        temporaryPassword,
        loginUrl: this.loginUrl,
        year: this.year,
      }),
    );
  }

  /**
   * A generic portal notification email (the email face of an in-app notification). Unlike the
   * fire-and-forget auth mails, this throws on a delivery failure so the notification dispatcher can
   * record the failure and retry it.
   */
  async sendNotification(opts: {
    to: string;
    firstName?: string;
    lastName?: string;
    title: string;
    body: string;
    actionUrl?: string;
    actionLabel?: string;
  }): Promise<void> {
    await this.sendOrThrow(
      opts.to,
      notificationEmail({
        firstName: opts.firstName,
        lastName: opts.lastName,
        title: opts.title,
        body: opts.body,
        actionUrl: opts.actionUrl,
        actionLabel: opts.actionLabel,
        year: this.year,
      }),
    );
  }

  /**
   * A report sent out on a schedule, with its workbook or document attached.
   *
   * Unlike the notification sends above, this one throws. A scheduled report that fails silently is
   * worse than one that fails loudly: nobody is waiting for it, so nobody notices it never came.
   */
  async sendReport(opts: {
    to: string;
    subject: string;
    title: string;
    body: string;
    attachment: { filename: string; content: Buffer; contentType: string };
  }): Promise<void> {
    await this.sendOrThrow(
      opts.to,
      notificationEmail({ title: opts.title, body: opts.body, year: this.year }),
      { subject: opts.subject, attachments: [opts.attachment] },
    );
  }

  /** Fire-and-forget send: a failure is logged but never propagated (used by auth flows). */
  private async send(to: string, email: RenderedEmail): Promise<void> {
    try {
      await this.sendOrThrow(to, email);
    } catch (err) {
      // A mail failure must not break the calling flow (e.g. account creation).
      this.logger.error(`Failed to send email to ${to}`, err as Error);
    }
  }

  /** Send and surface any provider error to the caller. In demo mode, logs and returns. */
  private async sendOrThrow(
    to: string,
    email: RenderedEmail,
    extra?: {
      subject?: string;
      attachments?: { filename: string; content: Buffer; contentType: string }[];
    },
  ): Promise<void> {
    const subject = extra?.subject ?? email.subject;
    if (!this.enabled) {
      const attached = extra?.attachments?.length
        ? `\nAttached: ${extra.attachments.map((a) => a.filename).join(', ')}`
        : '';
      this.logger.log(
        `\n----- EMAIL (demo mode) -----\nTo: ${to}\nSubject: ${subject}${attached}\n${email.text}\n-----------------------------`,
      );
      return;
    }
    await sgMail.send({
      to,
      from: { email: this.from, name: this.fromName },
      subject,
      text: email.text,
      html: email.html,
      attachments: extra?.attachments?.map((a) => ({
        filename: a.filename,
        // SendGrid takes attachment content base64-encoded.
        content: a.content.toString('base64'),
        type: a.contentType,
        disposition: 'attachment',
      })),
    });
    this.logger.log(`Email sent to ${to}: ${subject}`);
  }
}
