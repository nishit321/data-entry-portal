import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, User } from '@prisma/client';
import { authenticator } from 'otplib';
import { randomInt } from 'crypto';
import { toString as qrToString } from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestContext } from '../common/utils/request-context.util';
import { hashToken } from '../common/utils/token.util';
import {
  constantTimeEquals,
  keyFrom,
  open,
  seal,
  SecretBoxError,
} from '../common/utils/secret-box.util';
import { TotpConfig } from '../config/configuration';

/**
 * Our own configured verifier, one step either side of now.
 *
 * A handset's clock drifts, so a code generated a few seconds early or late still has to work.
 * Wider than one step and a stolen code stays useful for minutes; this is what RFC 6238 suggests
 * and what every authenticator app assumes.
 *
 * `clone` rather than assigning to `authenticator.options`. That assignment *replaces* the options
 * object rather than merging into it, taking the base32 key decoder with it, and every verification
 * in the process then fails on a type error deep inside the library. It looks like a one-line
 * setting and it breaks the feature outright.
 */
const totp = authenticator.clone({ window: 1 });

/** How many recovery codes to issue. Enough to survive a few uses without becoming a keyring. */
const RECOVERY_CODE_COUNT = 10;

/** Unambiguous alphabet: no O/0, no I/1/l. These get read off a screen and typed by hand. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_LENGTH = 10;

/**
 * One spelling of a recovery code, for hashing and for comparing.
 *
 * They are shown grouped (`ABCDE-FGHIJ`) because that is how somebody reads one off a screen, and
 * typed back however the person felt like typing it: with the dash, without it, in lower case,
 * with a stray space from a copy and paste. Hashing the displayed form and comparing the typed
 * form is how a recovery code silently never matches, which is only discovered by the person
 * locked out of their account.
 */
function canonicalRecoveryCode(code: string): string {
  return (code ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export interface TotpEnrolment {
  /** The `otpauth://` URI, for pasting into an app that cannot scan. */
  uri: string;
  /** The same thing as an SVG data URI, rendered here so no QR library ships to the browser. */
  qrSvg: string;
  /** The secret in text, for typing in by hand. */
  secret: string;
}

export interface TotpStatus {
  /** Whether the server can offer this at all: false when no encryption key is configured. */
  available: boolean;
  enabled: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
}

/**
 * The authenticator-app second factor (Q8).
 *
 * The requirement is explicit: *"never rely on SMS alone: offer authenticator-app (TOTP) as a
 * second factor"*. Until now the only second factor was a code sent by email, which means the
 * portal's sign-in depends on a third party being up. If the mail provider has a bad morning,
 * nobody signs in — not an operator with a deadline, not an approver, not an administrator. TOTP
 * is the one factor that needs nothing but the phone already in the user's hand.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * - **A secret is not live until it is confirmed.** Enrolment writes a secret; only a correct code
 *   switches the factor on. Otherwise a half-finished enrolment locks somebody out of their own
 *   account with a secret they never scanned.
 * - **A code cannot be replayed.** It is valid for its whole 30-second window, so without
 *   remembering the last step accepted, the same six digits work twice — and anyone who read them
 *   over a shoulder has the rest of the window to use them.
 * - **Recovery codes are shown once.** They are hashed, like passwords. If they could be read back
 *   later they would be a second password sitting in the database.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly config: TotpConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.config = config.get<TotpConfig>('totp') ?? { encryptionKey: '', issuer: 'NCA Portal' };
  }

  /** The encryption key, or a refusal that says what to fix. */
  private key(): Buffer {
    try {
      return keyFrom(this.config.encryptionKey);
    } catch (error) {
      throw new ServiceUnavailableException(
        'Authenticator apps are not set up on this system yet. ' +
          (error instanceof SecretBoxError ? error.message : ''),
      );
    }
  }

  /** Whether the server can offer this at all, so a screen can say so before asking. */
  isAvailable(): boolean {
    try {
      keyFrom(this.config.encryptionKey);
      return true;
    } catch {
      return false;
    }
  }

  async status(userId: string): Promise<TotpStatus> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpConfirmedAt: true },
    });
    const remaining = user.totpConfirmedAt
      ? await this.prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return {
      available: this.isAvailable(),
      enabled: Boolean(user.totpConfirmedAt),
      confirmedAt: user.totpConfirmedAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining,
    };
  }

  /**
   * Start enrolment: mint a secret, hand back something to scan.
   *
   * The factor is not switched on here. The secret is stored unconfirmed, and stays inert until a
   * code proves the app holds it.
   */
  async beginEnrolment(userId: string): Promise<TotpEnrolment> {
    const key = this.key();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, totpConfirmedAt: true },
    });
    if (user.totpConfirmedAt) {
      throw new ConflictException(
        'An authenticator app is already set up. Remove it first if you want to use a different one.',
      );
    }

    const secret = totp.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: seal(secret, key), totpConfirmedAt: null, totpLastStep: null },
    });

    const uri = totp.keyuri(user.email, this.config.issuer, secret);
    // Rendered on the server so no QR library reaches the browser bundle. It is shown on one
    // screen, once, and the first load is measured (FRONTEND_STANDARDS §7).
    const svg = await qrToString(uri, { type: 'svg', margin: 1, width: 200 });
    return {
      uri,
      qrSvg: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
      secret,
    };
  }

  /** Finish enrolment: a correct code switches the factor on and returns the recovery codes once. */
  async confirmEnrolment(
    userId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const key = this.key();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpConfirmedAt) {
      throw new ConflictException('An authenticator app is already set up.');
    }
    if (!user.totpSecret) {
      throw new BadRequestException('Start setting up the app before confirming a code.');
    }

    const secret = open(user.totpSecret, key);
    if (!this.checkCode(secret, code)) {
      throw new BadRequestException('That code is wrong. Check the app and try again.');
    }

    const codes = TotpService.generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpConfirmedAt: new Date(), totpLastStep: this.stepFor(secret, code) },
      }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.totpRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashToken(canonicalRecoveryCode(c)) })),
      }),
    ]);

    await this.audit.record({
      action: AuditAction.USER_TOTP_ENROLLED,
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      context: ctx,
    });

    // Returned once and never again: they are hashed, so there is nothing to show later.
    return { recoveryCodes: codes };
  }

  /**
   * Turn the factor off.
   *
   * A current code or a recovery code is required, even though the caller is already signed in.
   * Otherwise a session left open on a shared machine is enough to strip the second factor off an
   * account, quietly, and the next person to sit down has only a password to get past.
   */
  async disable(userId: string, code: string, ctx: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpConfirmedAt) {
      throw new BadRequestException('No authenticator app is set up.');
    }
    if (!(await this.verifyForUser(user, code))) {
      throw new BadRequestException('That code is wrong or has already been used.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
      }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    ]);

    await this.audit.record({
      action: AuditAction.USER_TOTP_DISABLED,
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      context: ctx,
    });
  }

  /**
   * An administrator removes somebody else's authenticator app.
   *
   * The case this exists for is the ordinary one: a person loses the phone *and* the recovery codes,
   * and without this the only way back into their account is somebody editing the database by hand.
   * That is not auditable, not repeatable, and not safe.
   *
   * It is also, unavoidably, the shape of an account takeover. So three things hold it down:
   *
   * - **Only an administrator**, enforced by the route.
   * - **Never on yourself.** An administrator who has lost their own phone is reset by another
   *   administrator. Allowing self-reset would let anybody holding an admin session shed their own
   *   second factor, which is the one thing standing between a stolen laptop and the whole portal.
   * - **The account holder is told**, by every channel they have. They are the only person certain
   *   to know they did not ask for it, and this is what turns a silent takeover into a phone call.
   *
   * What is left afterwards is an account that signs in with a password and an emailed code, and
   * can enrol a new app. The second factor is not switched off; it falls back.
   */
  async resetFor(
    targetUserId: string,
    actorId: string,
    ctx: RequestContext,
  ): Promise<{ hadAuthenticatorApp: boolean }> {
    if (targetUserId === actorId) {
      throw new BadRequestException(
        'Use your own security settings to change your authenticator app. Another administrator ' +
          'can reset it for you if you have lost it.',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, totpConfirmedAt: true },
    });
    if (!target) throw new NotFoundException('That user does not exist.');

    const hadAuthenticatorApp = Boolean(target.totpConfirmedAt);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
      }),
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId: targetUserId } }),
      // Any half-finished sign-in waiting on the app they no longer have.
      this.prisma.otpChallenge.updateMany({
        where: { userId: targetUserId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);

    // Read rather than taken from the token: the JWT carries an id, a role and an entity, not a
    // name, and the person being reset deserves to be told who did it.
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true, lastName: true },
    });

    await this.audit.record({
      action: AuditAction.USER_MFA_RESET_BY_ADMIN,
      actorId,
      entityType: 'User',
      entityId: targetUserId,
      metadata: { hadAuthenticatorApp },
      context: ctx,
    });

    // Told afterwards, and never blocking: the reset has happened, and a mail provider having a bad
    // morning must not leave the account in a half-reset state.
    await this.notifications.mfaResetByAdmin({
      userId: targetUserId,
      byName: `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim() || 'An administrator',
    });

    return { hadAuthenticatorApp };
  }

  /** Issue a fresh set, invalidating the old. Requires a current code, for the same reason. */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpConfirmedAt) {
      throw new BadRequestException('No authenticator app is set up.');
    }
    if (!(await this.verifyForUser(user, code))) {
      throw new BadRequestException('That code is wrong or has already been used.');
    }

    const codes = TotpService.generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.totpRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: hashToken(canonicalRecoveryCode(c)) })),
      }),
    ]);

    await this.audit.record({
      action: AuditAction.USER_TOTP_RECOVERY_REGENERATED,
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      context: ctx,
    });

    return { recoveryCodes: codes };
  }

  /**
   * Check a code at sign-in: six digits from the app, or one recovery code.
   *
   * Returns false rather than throwing, so the caller decides what a failure means. The caller is
   * the login flow, which counts failures towards the account lockout.
   */
  async verifyForUser(user: User, code: string): Promise<boolean> {
    const cleaned = canonicalRecoveryCode(code);
    if (!cleaned) return false;

    // Six digits is an app code; anything else is treated as a recovery code.
    if (/^\d{6}$/.test(cleaned)) {
      if (!user.totpSecret) return false;
      let secret: string;
      try {
        secret = open(user.totpSecret, this.key());
      } catch {
        // The key has changed, or the row is damaged. Refuse rather than let the user through.
        this.logger.error(`Could not read the TOTP secret for user ${user.id}.`);
        return false;
      }
      if (!this.checkCode(secret, cleaned)) return false;

      const step = this.stepFor(secret, cleaned);
      // Replay: a code is valid for its whole window, so the same digits would otherwise work
      // twice. Anything at or before the last accepted step is refused.
      if (user.totpLastStep !== null && step !== null && step <= user.totpLastStep) return false;
      await this.prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
      return true;
    }

    return this.consumeRecoveryCode(user.id, cleaned);
  }

  /** Spend a recovery code. Single use: the row is marked rather than deleted, so it is auditable. */
  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const wanted = hashToken(canonicalRecoveryCode(code));
    const candidates = await this.prisma.totpRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    const match = candidates.find((c) => constantTimeEquals(c.codeHash, wanted));
    if (!match) return false;

    // Conditional on still being unused, so two requests racing cannot both spend the same code.
    const spent = await this.prisma.totpRecoveryCode.updateMany({
      where: { id: match.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (spent.count === 0) return false;

    const left = await this.prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } });
    this.logger.warn(`A recovery code was used for user ${userId}. ${left} left.`);
    return true;
  }

  /** True when the code matches, allowing for one step of clock drift either way. */
  private checkCode(secret: string, code: string): boolean {
    try {
      return totp.check(code, secret);
    } catch {
      return false;
    }
  }

  /**
   * Which 30-second step the code belongs to, or null if it belongs to none.
   *
   * Replay protection needs this, and "the code was valid" is not enough on its own: it stays
   * valid for the rest of its window. `checkDelta` answers with how far off the current step the
   * match was, which is exactly the number needed and saves reimplementing the search.
   */
  private stepFor(secret: string, code: string): number | null {
    try {
      const delta = totp.checkDelta(code, secret);
      if (delta === null || delta === undefined) return null;
      return Math.floor(Date.now() / 1000 / 30) + delta;
    } catch {
      return null;
    }
  }

  /** Ten single-use codes, in an alphabet nobody will misread off a screen. */
  static generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const body = Array.from(
        { length: RECOVERY_CODE_LENGTH },
        () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)],
      ).join('');
      // Grouped, because these are read aloud and typed by hand.
      return `${body.slice(0, 5)}-${body.slice(5)}`;
    });
  }
}
