import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  AuditAction,
  EntityStatus,
  EntityType,
  MfaMethod,
  NotificationType,
  Role,
} from '@prisma/client';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { keyFrom, open } from '../src/common/utils/secret-box.util';

jest.setTimeout(120000);

const PASSWORD = 'Passw0rd!23';
const OTP = '123456';

/** The same window the server verifies with, so the test agrees with the thing it is testing. */
const app_totp = authenticator.clone({ window: 1 });

/**
 * A code from the *next* thirty-second window.
 *
 * Enrolment consumes the step it was confirmed with, so a code minted in that same window is
 * correctly refused as a replay. A real person confirms and signs in some moments later; a test
 * that runs in milliseconds does not, and the difference is the test's problem rather than the
 * guard's. The server allows one step of drift, so this is accepted exactly as a real user's next
 * code would be.
 */
function codeForNextWindow(secret: string): string {
  return app_totp.clone({ epoch: Date.now() + 30_000 }).generate(secret);
}

/**
 * The authenticator-app second factor, end to end (Q8).
 *
 * The requirement is *"never rely on SMS alone: offer authenticator-app (TOTP) as a second
 * factor"*, and until this existed the only second factor was a code sent by email — so the
 * portal's sign-in depended on a mail provider being up. What is asserted here is not only that
 * the happy path works, but that the ways it could be weakened are closed: a replayed code, a
 * reused recovery code, an unconfirmed secret gating a login, and an attacker asking politely for
 * an emailed code instead.
 */
describe('authenticator app (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const EMAIL = 'totp-user@x.test';
  const LICENCE = 'TOTP/A';
  let userId: string;
  let token: string;

  async function cleanup() {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.entity.deleteMany({ where: { licenceNumber: LICENCE } });
  }

  /** Sign in with the emailed code, which is the state before anybody enrols. */
  async function signInWithEmailCode(): Promise<string> {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.body.method).toBe('email');
    const verified = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: login.body.challengeId, code: OTP });
    // 200, not 201: the controller sets it. Signing in creates no resource.
    expect(verified.status).toBe(200);
    return verified.body.accessToken as string;
  }

  /** The secret the server stored, read back the way the server would. */
  async function storedSecret(): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return open(user.totpSecret as string, keyFrom(process.env.TOTP_ENCRYPTION_KEY as string));
  }

  /** Enrol and confirm, returning the recovery codes handed over once. */
  async function enrol(): Promise<{ secret: string; recoveryCodes: string[] }> {
    const begun = await request(server)
      .post('/api/v1/auth/totp')
      .set('Authorization', `Bearer ${token}`);
    expect(begun.status).toBe(201);

    const secret = await storedSecret();
    const confirmed = await request(server)
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: app_totp.generate(secret) });
    expect(confirmed.status).toBe(201);
    return { secret, recoveryCodes: confirmed.body.recoveryCodes as string[] };
  }

  beforeAll(async () => {
    // A key of our own, so the suite does not depend on the developer's .env having one.
    process.env.TOTP_ENCRYPTION_KEY =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();
    const entity = await prisma.entity.create({
      data: {
        name: 'TOTP Telecom',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: LICENCE,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        firstName: 'Totp',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.totpRecoveryCode.deleteMany({ where: { userId } });
    await prisma.otpChallenge.deleteMany({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null },
    });
    token = await signInWithEmailCode();
  });

  describe('setting it up', () => {
    it('hands over something to scan without switching the factor on', async () => {
      const begun = await request(server)
        .post('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${token}`);

      expect(begun.status).toBe(201);
      expect(begun.body.uri).toMatch(/^otpauth:\/\/totp\//);
      expect(begun.body.uri).toContain(encodeURIComponent(EMAIL));
      expect(begun.body.qrSvg).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(begun.body.secret).toMatch(/^[A-Z2-7]+$/);

      // Not live yet. A half-finished enrolment must never start gating sign-ins.
      const status = await request(server)
        .get('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${token}`);
      expect(status.body.enabled).toBe(false);
    });

    it('never stores the secret in a form the database can read', async () => {
      await request(server).post('/api/v1/auth/totp').set('Authorization', `Bearer ${token}`);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const plain = await storedSecret();
      // The point of the key living outside the database: a dump is inert.
      expect(row.totpSecret).not.toContain(plain);
      expect(row.totpSecret).toMatch(/^v1\./);
    });

    it('switches on with a correct code and hands over recovery codes once', async () => {
      const { recoveryCodes } = await enrol();

      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

      const status = await request(server)
        .get('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${token}`);
      expect(status.body.enabled).toBe(true);
      expect(status.body.recoveryCodesRemaining).toBe(10);

      // Hashed, so there is nothing to hand over a second time.
      const stored = await prisma.totpRecoveryCode.findMany({ where: { userId } });
      for (const row of stored) {
        expect(recoveryCodes).not.toContain(row.codeHash);
      }
    });

    it('refuses a wrong code, and stays off', async () => {
      await request(server).post('/api/v1/auth/totp').set('Authorization', `Bearer ${token}`);

      const bad = await request(server)
        .post('/api/v1/auth/totp/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' });

      expect(bad.status).toBe(400);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.totpConfirmedAt).toBeNull();
    });

    it('records the enrolment in the audit log', async () => {
      await enrol();
      const entries = await prisma.auditLog.findMany({
        where: { actorId: userId, action: AuditAction.USER_TOTP_ENROLLED },
      });
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe('signing in with it', () => {
    it('asks for the app instead of emailing a code', async () => {
      const { secret } = await enrol();

      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      expect(login.body.mfaRequired).toBe(true);
      expect(login.body.method).toBe('totp');
      expect(login.body.recoveryAvailable).toBe(true);
      // Nothing was generated to send. A TOTP challenge holds no code of its own.
      const challenge = await prisma.otpChallenge.findUniqueOrThrow({
        where: { id: login.body.challengeId },
      });
      expect(challenge.method).toBe(MfaMethod.TOTP);
      expect(challenge.codeHash).toBeNull();

      const verified = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code: codeForNextWindow(secret) });
      expect(verified.status).toBe(200);
      expect(verified.body.accessToken).toBeTruthy();
    });

    it('refuses the same code twice', async () => {
      // A code is valid for its whole thirty-second window. Without the last-step check the same
      // six digits work again, and anybody who read them over a shoulder has the rest of the
      // window to use them.
      const { secret } = await enrol();
      const code = codeForNextWindow(secret);

      const first = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      expect(
        (
          await request(server)
            .post('/api/v1/auth/verify-otp')
            .send({ challengeId: first.body.challengeId, code })
        ).status,
      ).toBe(200);

      const second = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const replayed = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: second.body.challengeId, code });

      expect(replayed.status).toBe(401);
    });

    it('accepts a recovery code, once, and says so in the audit log', async () => {
      const { recoveryCodes } = await enrol();
      const code = recoveryCodes[0]!;

      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const used = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code });
      expect(used.status).toBe(200);

      // Spent. A recovery code that worked twice would be a password, not a recovery code.
      const again = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const reused = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: again.body.challengeId, code });
      expect(reused.status).toBe(401);

      const entries = await prisma.auditLog.findMany({
        where: { actorId: userId, action: AuditAction.USER_TOTP_RECOVERY_USED },
      });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('will not hand out an emailed code instead', async () => {
      // The downgrade an attacker would ask for. If resending worked, the account would be exactly
      // as strong as the mailbox and the app would count for nothing.
      const { secret } = await enrol();
      void secret;

      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const resent = await request(server)
        .post('/api/v1/auth/resend-otp')
        .send({ challengeId: login.body.challengeId });

      expect(resent.status).toBe(400);
      expect(resent.body.message).toMatch(/authenticator app/i);
    });

    it('does not accept a code for a secret that was never confirmed', async () => {
      // An abandoned enrolment leaves a secret behind. It must not gate anything.
      await request(server).post('/api/v1/auth/totp').set('Authorization', `Bearer ${token}`);
      const secret = await storedSecret();

      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      expect(login.body.method).toBe('email');

      const attempted = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code: codeForNextWindow(secret) });
      expect(attempted.status).toBe(401);
    });
  });

  describe('turning it off and rotating codes', () => {
    it('needs a current code to switch off', async () => {
      const { secret } = await enrol();

      const withoutCode = await request(server)
        .delete('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' });
      expect(withoutCode.status).toBe(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpConfirmedAt,
      ).not.toBeNull();

      const removed = await request(server)
        .delete('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: codeForNextWindow(secret) });
      expect(removed.status).toBe(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.totpConfirmedAt).toBeNull();
      expect(user.totpSecret).toBeNull();
      // The old recovery codes go with it, or they would still open an account with no app on it.
      expect(await prisma.totpRecoveryCode.count({ where: { userId } })).toBe(0);
    });

    it('replaces the whole set when codes are regenerated', async () => {
      const { secret, recoveryCodes } = await enrol();

      const fresh = await request(server)
        .post('/api/v1/auth/totp/recovery-codes')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: codeForNextWindow(secret) });
      expect(fresh.status).toBe(201);

      const next = fresh.body.recoveryCodes as string[];
      expect(next).toHaveLength(10);
      expect(next.some((c) => recoveryCodes.includes(c))).toBe(false);
      expect(await prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } })).toBe(10);

      // The old ones are gone, not merely superseded.
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const withOld = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code: recoveryCodes[0] });
      expect(withOld.status).toBe(401);
    });
  });

  describe('an administrator resetting it for somebody', () => {
    const ADMIN_EMAIL = 'totp-admin@x.test';
    let adminToken: string;
    let adminId: string;

    beforeAll(async () => {
      const admin = await prisma.user.create({
        data: {
          email: ADMIN_EMAIL,
          passwordHash: await hashPassword(PASSWORD),
          firstName: 'Ada',
          lastName: 'Admin',
          role: Role.ADMIN,
        },
      });
      adminId = admin.id;
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN_EMAIL, password: PASSWORD });
      const verified = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code: OTP });
      adminToken = verified.body.accessToken as string;
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
    });

    it('rescues an account whose phone and recovery codes are both gone', async () => {
      // The whole reason this exists. Before it, the only way back was editing the database.
      const { recoveryCodes } = await enrol();

      const reset = await request(server)
        .post(`/api/v1/users/${userId}/reset-mfa`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(reset.status).toBe(200);
      expect(reset.body.hadAuthenticatorApp).toBe(true);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.totpSecret).toBeNull();
      expect(user.totpConfirmedAt).toBeNull();
      // The old recovery codes go too, or they would still open an account with no app on it.
      expect(await prisma.totpRecoveryCode.count({ where: { userId } })).toBe(0);

      // Back to an emailed code, and able to enrol again. The factor fell back; it did not vanish.
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      expect(login.body.method).toBe('email');
      const verified = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code: OTP });
      expect(verified.status).toBe(200);

      // And the codes it replaced are dead.
      const stale = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const withOld = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: stale.body.challengeId, code: recoveryCodes[0] });
      expect(withOld.status).toBe(401);
    });

    it('tells the person it happened to, and says who did it', async () => {
      // The detection control. Resetting a second factor is also how an account is taken over, and
      // the account holder is the only one certain to know they never asked.
      await enrol();
      await prisma.notification.deleteMany({ where: { recipientId: userId } });

      await request(server)
        .post(`/api/v1/users/${userId}/reset-mfa`)
        .set('Authorization', `Bearer ${adminToken}`);

      const told = await prisma.notification.findMany({ where: { recipientId: userId } });
      expect(told).toHaveLength(1);
      expect(told[0]!.type).toBe(NotificationType.SECURITY_MFA_RESET);
      expect(told[0]!.body).toContain('Ada Admin');
    });

    it('records who reset whose', async () => {
      await enrol();
      await request(server)
        .post(`/api/v1/users/${userId}/reset-mfa`)
        .set('Authorization', `Bearer ${adminToken}`);

      const entries = await prisma.auditLog.findMany({
        where: { action: AuditAction.USER_MFA_RESET_BY_ADMIN, actorId: adminId, entityId: userId },
      });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('refuses to let an administrator reset their own', async () => {
      /*
       * The one that matters most. An administrator who could reset themselves could shed their own
       * second factor from a session already open — which is the only thing standing between a
       * stolen laptop and the whole portal. Another administrator does it for them.
       */
      const self = await request(server)
        .post(`/api/v1/users/${adminId}/reset-mfa`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(self.status).toBe(400);
      expect(self.body.message).toMatch(/your own security settings/i);
    });

    it('is closed to anybody who is not an administrator', async () => {
      const asOperator = await request(server)
        .post(`/api/v1/users/${adminId}/reset-mfa`)
        .set('Authorization', `Bearer ${token}`);
      expect(asOperator.status).toBe(403);
    });

    it('is closed to anybody not signed in at all', async () => {
      const anonymous = await request(server).post(`/api/v1/users/${userId}/reset-mfa`);
      expect(anonymous.status).toBe(401);
    });

    it('says plainly when there was no app to remove', async () => {
      // Not an error: an administrator clearing a half-finished enrolment is a reasonable thing to
      // do, and the answer tells them what they actually changed.
      const reset = await request(server)
        .post(`/api/v1/users/${userId}/reset-mfa`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(reset.status).toBe(200);
      expect(reset.body.hadAuthenticatorApp).toBe(false);
    });
  });

  describe('when no key is configured', () => {
    it('says it is unavailable rather than storing a secret in the clear', async () => {
      const real = process.env.TOTP_ENCRYPTION_KEY;
      process.env.TOTP_ENCRYPTION_KEY = '';

      // A fresh app, because the key is read once when the service is constructed.
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const bare = moduleRef.createNestApplication();
      configureApp(bare);
      await bare.init();

      const login = await request(bare.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const verified = await request(bare.getHttpServer())
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId: login.body.challengeId, code: OTP });
      const bareToken = verified.body.accessToken as string;

      const status = await request(bare.getHttpServer())
        .get('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${bareToken}`);
      expect(status.body.available).toBe(false);

      const attempted = await request(bare.getHttpServer())
        .post('/api/v1/auth/totp')
        .set('Authorization', `Bearer ${bareToken}`);
      expect(attempted.status).toBe(503);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpSecret,
      ).toBeNull();

      await bare.close();
      process.env.TOTP_ENCRYPTION_KEY = real;
    });
  });
});
