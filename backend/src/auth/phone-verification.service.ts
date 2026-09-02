import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { hashToken } from '../common/utils/token.util';
import { maskPhone, normalisePhone } from '../common/utils/phone.util';
import { SMS_PROVIDER, SmsProvider, SmsSendError } from '../notifications/sms/sms-provider';

/** How long a code is good for. Short: it is read off a handset that is already in your hand. */
const CODE_TTL_MIN = 10;

/** Wrong guesses allowed before the code is burned. Six digits is a million to one per guess. */
const MAX_ATTEMPTS = 5;

/**
 * How many codes one account may ask for in an hour.
 *
 * Every one of these costs the Authority money and lands on somebody's handset. Without a cap, an
 * account can be used to spend the SMS balance, or to make one person's phone ring all night with
 * codes they did not ask for.
 */
const MAX_SENDS_PER_HOUR = 5;

export interface PhoneChallenge {
  /** Never the whole number: this is echoed back to a browser and written to logs. */
  maskedPhone: string;
  expiresInSec: number;
}

/**
 * Proving that a phone number belongs to the person who typed it.
 *
 * Worth doing rather than taking their word for it. A mistyped digit in an email address bounces;
 * a mistyped digit in a phone number is somebody else's working number, and the Authority's
 * deadline reminders go there instead, silently, for as long as the record stands. The operator
 * hears nothing and concludes the portal does not send reminders.
 *
 * The code is **random**, not the fixed demo code the login flow can fall back on. A verification
 * that accepts a code anybody knows proves nothing at all, which would make the whole exercise
 * theatre.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** Six digits, from a source fit for the job. `Math.random` is not one. */
  private static generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  async start(userId: string, rawPhone: string, ctx: RequestContext): Promise<PhoneChallenge> {
    if (!this.sms.isConfigured()) {
      /*
       * Refused rather than issued. Sending a code nobody can receive leaves the user staring at a
       * box they can never fill in, and leaves a half-finished verification in the database. Better
       * to say plainly that the channel is not set up.
       */
      throw new ServiceUnavailableException(
        'Text messages are not set up yet, so a number cannot be confirmed. Ask the Authority to ' +
          'configure the SMS gateway.',
      );
    }

    const phone = normalisePhone(rawPhone);
    if (!phone) {
      throw new BadRequestException(
        'That does not look like a phone number. Include the country code, or start with 0 for a ' +
          'South Sudanese number.',
      );
    }

    const anHourAgo = new Date(Date.now() - 60 * 60_000);
    const recent = await this.prisma.phoneVerification.count({
      where: { userId, createdAt: { gt: anHourAgo } },
    });
    if (recent >= MAX_SENDS_PER_HOUR) {
      throw new ConflictException(
        'That is a lot of codes in one hour. Wait a while before asking for another.',
      );
    }

    const code = PhoneVerificationService.generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);

    // One live challenge at a time, so an old code cannot be used against a newly typed number.
    await this.prisma.phoneVerification.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.phoneVerification.create({
      data: { userId, phone, codeHash: hashToken(code), expiresAt },
    });

    try {
      await this.sms.send(
        phone,
        `${code} is your NCA Portal confirmation code. It expires in ${CODE_TTL_MIN} minutes.`,
      );
    } catch (error) {
      /*
       * The challenge stays in the database. It expires on its own, and leaving it there means a
       * retry does not look like a fresh start to the hourly cap — which is the point of the cap
       * when a bad number is failing over and over.
       */
      /*
       * The gateway's own wording goes to the log, not to the operator. "Insufficient balance" is
       * a fact about the Authority's SMS account, and an operator filing a return has no business
       * learning it; nor would it help them. What helps them is knowing the number did not work.
       */
      const detail = error instanceof SmsSendError ? error.message : 'the gateway did not answer';
      this.logger.warn(`Could not send a confirmation code to ${maskPhone(phone)}: ${detail}`);
      throw new UnprocessableEntityException(
        'We could not send a code to that number. Check it and try again.',
      );
    }

    await this.audit.record({
      action: AuditAction.USER_PHONE_CHALLENGED,
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      context: ctx,
    });

    return { maskedPhone: maskPhone(phone), expiresInSec: CODE_TTL_MIN * 60 };
  }

  async confirm(userId: string, code: string, ctx: RequestContext): Promise<{ phone: string }> {
    // One message for every way this can fail. Saying which part was wrong tells somebody probing
    // the difference between "no such challenge" and "wrong code".
    const invalid = new BadRequestException('That code is wrong or has expired.');

    const challenge = await this.prisma.phoneVerification.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.expiresAt < new Date()) throw invalid;

    if (challenge.attempts >= MAX_ATTEMPTS) {
      await this.prisma.phoneVerification.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw invalid;
    }

    if (challenge.codeHash !== hashToken(code.trim())) {
      await this.prisma.phoneVerification.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { phone: challenge.phone, phoneVerifiedAt: new Date() },
        select: { phone: true },
      }),
      this.prisma.phoneVerification.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.USER_PHONE_VERIFIED,
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      context: ctx,
    });

    return { phone: user.phone as string };
  }

  async remove(userId: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { phone: null, phoneVerifiedAt: null },
      }),
      this.prisma.phoneVerification.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.USER_PHONE_REMOVED,
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      context: ctx,
    });
  }

  /** Whether a number can be confirmed at all right now, so the UI can say so before asking. */
  isAvailable(): boolean {
    return this.sms.isConfigured();
  }
}
