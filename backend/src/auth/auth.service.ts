import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { ResetConfig, SecurityConfig } from '../config/configuration';
import { RequestContext } from '../common/utils/request-context.util';
import { hashPassword, verifyPassword } from '../common/utils/password.util';
import { generateRawToken, hashToken } from '../common/utils/token.util';
import {
  SignupDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyOtpDto,
  ResendOtpDto,
} from './dto/auth.dto';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  entityId: string | null;
  /** E.164, or null. Present only once confirmed: an unproved number is not a contact detail. */
  phone: string | null;
  phoneVerifiedAt: string | null;
}

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

/** Returned by login when MFA is on: the token is withheld until OTP is verified. */
export interface MfaChallenge {
  mfaRequired: true;
  challengeId: string;
  expiresInSec: number;
  /** Only outside production: the static demo OTP, so testers can proceed. */
  devOtp?: string;
}

export type LoginResult = AuthResult | MfaChallenge;

/** HTTP 423 Locked — not in Nest's HttpStatus enum, so used numerically. */
const HTTP_LOCKED = 423;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private signToken(user: Pick<User, 'id' | 'email' | 'role' | 'entityId'>): string {
    return this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      entityId: user.entityId,
    });
  }

  private toPublicUser(u: User): PublicUser {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      isActive: u.isActive,
      entityId: u.entityId,
      phone: u.phone,
      phoneVerifiedAt: u.phoneVerifiedAt?.toISOString() ?? null,
    };
  }

  /**
   * Public self-registration. New sign-ups receive the lowest-privilege role;
   * internal/elevated roles are assigned afterwards by an ADMIN.
   */
  async signup(dto: SignupDto, ctx: RequestContext): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(dto.password),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        role: Role.OPERATOR_SUBMITTER,
      },
    });

    await this.audit.record({
      action: AuditAction.USER_SIGNUP,
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      context: ctx,
    });

    return { accessToken: this.signToken(user), user: this.toPublicUser(user) };
  }

  /**
   * Step 1 of login: verify the password with brute-force lockout. On success,
   * either issue an OTP challenge (MFA on) or complete the login (MFA off).
   */
  async login(dto: LoginDto, ctx: RequestContext): Promise<LoginResult> {
    const security = this.config.get<SecurityConfig>('security')!;
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    const invalid = new UnauthorizedException('Invalid email or password');
    // A service account exists so a machine credential's filings have an author. It is not a person
    // and has no way in here — treated exactly like an unknown address, so its existence is not
    // something the login screen can be used to confirm.
    if (!user || user.deletedAt || user.isServiceAccount) {
      await this.audit.record({
        action: AuditAction.USER_LOGIN_FAILED,
        entityType: 'User',
        metadata: { email },
        context: ctx,
      });
      throw invalid;
    }

    // Brute-force lockout: reject while a lock is active.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Account locked due to repeated failed attempts. Please try again later.',
        HTTP_LOCKED,
      );
    }

    const ok = await verifyPassword(dto.password, user.passwordHash);
    if (!ok) {
      const attempts = user.failedLoginAttempts + 1;
      const lock = attempts >= security.maxLoginAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lock ? 0 : attempts,
          lockedUntil: lock
            ? new Date(Date.now() + security.lockoutMinutes * 60_000)
            : user.lockedUntil,
        },
      });
      await this.audit.record({
        action: AuditAction.USER_LOGIN_FAILED,
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
        metadata: { attempts },
        context: ctx,
      });
      if (lock) {
        await this.audit.record({
          action: AuditAction.USER_LOCKED,
          actorId: user.id,
          entityType: 'User',
          entityId: user.id,
          context: ctx,
        });
        throw new HttpException(
          `Account locked after ${security.maxLoginAttempts} failed attempts. Try again in ${security.lockoutMinutes} minutes.`,
          HTTP_LOCKED,
        );
      }
      throw invalid;
    }

    // Only reveal a deactivated account once the password is correct — otherwise the distinct
    // message would let an unauthenticated caller probe which emails exist.
    if (!user.isActive) {
      throw new UnauthorizedException('Your account is deactivated. Contact the Authority.');
    }

    // Password correct → clear any failure/lock state.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    // MFA gate: withhold the token until an OTP challenge is verified.
    if (security.mfaEnabled && user.mfaEnabled) {
      return this.issueOtpChallenge(user, security, ctx);
    }
    return this.completeLogin(user, ctx);
  }

  /** Issue (and "deliver") an OTP challenge; supersedes any outstanding one. */
  private async issueOtpChallenge(
    user: User,
    security: SecurityConfig,
    ctx: RequestContext,
  ): Promise<MfaChallenge> {
    const code = security.otpStaticCode;
    const codeHash = hashToken(code);
    const expiresAt = new Date(Date.now() + security.otpTtlMin * 60_000);

    await this.prisma.otpChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const challenge = await this.prisma.otpChallenge.create({
      data: { userId: user.id, codeHash, expiresAt },
    });

    // Deliver the code to the account's email. Mail failures are swallowed inside
    // MailService so they never block the challenge; outside production the code
    // is also returned as devOtp, and demo mode logs it to the console.
    await this.mail.sendOtpCode(
      user.email,
      user.firstName,
      user.lastName,
      code,
      security.otpTtlMin,
    );
    await this.audit.record({
      action: AuditAction.USER_MFA_CHALLENGED,
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      context: ctx,
    });

    return {
      mfaRequired: true,
      challengeId: challenge.id,
      expiresInSec: security.otpTtlMin * 60,
      // Echoing the code hands the second factor to whoever asked for the first, so it is off
      // unless deliberately switched on for a demo with no delivery channel.
      devOtp: security.otpEchoInResponse ? code : undefined,
    };
  }

  /** Step 2 of login: verify the OTP code and issue the token. */
  async verifyOtp(dto: VerifyOtpDto, ctx: RequestContext): Promise<AuthResult> {
    const security = this.config.get<SecurityConfig>('security')!;
    const invalid = new UnauthorizedException('Invalid or expired code');

    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: dto.challengeId },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw invalid;
    }
    if (challenge.attempts >= security.maxLoginAttempts) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw invalid;
    }

    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !user.isActive || user.deletedAt) throw invalid;

    if (hashToken(dto.code) !== challenge.codeHash) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: challenge.attempts + 1 },
      });
      await this.audit.record({
        action: AuditAction.USER_MFA_FAILED,
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
        context: ctx,
      });
      throw invalid;
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    return this.completeLogin(user, ctx);
  }

  /** Re-issue an OTP for an outstanding challenge (e.g. the user clicked resend). */
  async resendOtp(dto: ResendOtpDto, ctx: RequestContext): Promise<MfaChallenge> {
    const security = this.config.get<SecurityConfig>('security')!;
    const invalid = new UnauthorizedException(
      'Your verification session has expired. Please sign in again.',
    );
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: dto.challengeId },
    });
    if (!challenge) throw invalid;
    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !user.isActive || user.deletedAt) throw invalid;
    return this.issueOtpChallenge(user, security, ctx);
  }

  /** Finalise a successful login: stamp lastLoginAt, audit, and issue the JWT. */
  private async completeLogin(user: User, ctx: RequestContext): Promise<AuthResult> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      action: AuditAction.USER_LOGIN,
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      context: ctx,
    });
    return { accessToken: this.signToken(user), user: this.toPublicUser(user) };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Your session is no longer valid. Please sign in again.');
    }
    return this.toPublicUser(user);
  }

  /**
   * Always returns the same generic message so callers cannot enumerate which
   * email addresses have accounts.
   */
  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext): Promise<{ message: string }> {
    const genericResponse = {
      message: 'If an account exists for that email, a reset link has been sent.',
    };

    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // A service account has no mailbox and no person behind it; there is nothing to reset.
    if (!user || !user.isActive || user.deletedAt || user.isServiceAccount) {
      return genericResponse;
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const { frontendUrl, tokenTtlMin } = this.config.get<ResetConfig>('reset')!;
    const expiresAt = new Date(Date.now() + tokenTtlMin * 60 * 1000);

    // Invalidate previous unused tokens, then issue a fresh one.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);

    await this.mail.sendPasswordReset(user.email, `${frontendUrl}?token=${rawToken}`, tokenTtlMin);
    await this.audit.record({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      actorId: user.id,
      entityType: 'User',
      entityId: user.id,
      context: ctx,
    });

    return genericResponse;
  }

  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext): Promise<{ message: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hashPassword(dto.password) },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      actorId: record.userId,
      entityType: 'User',
      entityId: record.userId,
      context: ctx,
    });

    return { message: 'Password has been reset. You can now log in.' };
  }
}
