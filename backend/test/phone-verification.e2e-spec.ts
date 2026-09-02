import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditAction, EntityStatus, EntityType, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { SMS_PROVIDER, SmsProvider, SmsSendError } from '../src/notifications/sms/sms-provider';

jest.setTimeout(60000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';

/**
 * Confirming a phone number, end to end.
 *
 * The gateway is replaced at its own boundary — the `SmsProvider` interface — and nothing else is
 * faked. Everything above it is the real thing: the real guards, the real rate limits, the real
 * database. What a test cannot sensibly assert is whether a South Sudanese handset rang, so the
 * fake records what would have been sent and the assertions are about that.
 */
class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  configured = true;
  failWith: string | null = null;
  readonly sent: { to: string; message: string }[] = [];

  isConfigured() {
    return this.configured;
  }

  send(to: string, message: string) {
    if (this.failWith) throw new SmsSendError(this.failWith, this.name);
    this.sent.push({ to, message });
    return Promise.resolve({ providerRef: 'fake-ref', raw: {} });
  }

  /** The code out of the last message, which is the only way a real user gets it either. */
  lastCode(): string {
    const match = /(\d{6})/.exec(this.sent.at(-1)?.message ?? '');
    return match?.[1] ?? '';
  }
}

describe('phone verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;
  const sms = new FakeSmsProvider();

  const EMAIL = 'phone-user@x.test';
  const LICENCE = 'PHONE/A';
  let token: string;
  let userId: string;

  async function cleanup() {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.entity.deleteMany({ where: { licenceNumber: LICENCE } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();
    const entity = await prisma.entity.create({
      data: {
        name: 'Phone Telecom',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: LICENCE,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        firstName: 'Phone',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    userId = user.id;

    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    const verified = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: login.body.challengeId, code: OTP });
    token = verified.body.accessToken as string;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  beforeEach(async () => {
    sms.sent.length = 0;
    sms.failWith = null;
    sms.configured = true;
    await prisma.phoneVerification.deleteMany({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { phone: null, phoneVerifiedAt: null },
    });
  });

  const start = (phone: string) =>
    request(server)
      .post('/api/v1/auth/phone')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone });

  const confirm = (code: string) =>
    request(server)
      .post('/api/v1/auth/phone/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ code });

  describe('confirming a number', () => {
    it('texts a code to the number as typed, and stores it only once confirmed', async () => {
      // Typed the way a South Sudanese operator would write it down.
      const started = await start('0920 000 111');
      expect(started.status).toBe(201);
      expect(started.body.maskedPhone).toBe('••••0111');

      // Sent in the shape the portal stores, with the code in the body.
      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0]!.to).toBe('+211920000111');
      expect(sms.sent[0]!.message).toMatch(/^\d{6} is your NCA Portal confirmation code/);

      // Nothing on the user yet: an unproved number is not a contact detail.
      const before = await prisma.user.findUnique({ where: { id: userId } });
      expect(before!.phone).toBeNull();

      const confirmed = await confirm(sms.lastCode());
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.phone).toBe('+211920000111');

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.phone).toBe('+211920000111');
      expect(after!.phoneVerifiedAt).not.toBeNull();
    });

    it('shows the number on /auth/me once it is confirmed, and not before', async () => {
      await start('+211920000222');
      const midway = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(midway.body.phone).toBeNull();

      await confirm(sms.lastCode());
      const after = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(after.body.phone).toBe('+211920000222');
      expect(after.body.phoneVerifiedAt).not.toBeNull();
    });

    it('records the confirmation in the audit log', async () => {
      await start('+211920000333');
      await confirm(sms.lastCode());

      const entries = await prisma.auditLog.findMany({
        where: { actorId: userId, action: AuditAction.USER_PHONE_VERIFIED },
      });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('lets the number be removed again', async () => {
      await start('+211920000444');
      await confirm(sms.lastCode());

      const removed = await request(server)
        .delete('/api/v1/auth/phone')
        .set('Authorization', `Bearer ${token}`);
      expect(removed.status).toBe(204);

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.phone).toBeNull();
      expect(after!.phoneVerifiedAt).toBeNull();
    });
  });

  describe('when it should refuse', () => {
    it('rejects a wrong code without confirming anything', async () => {
      await start('+211920000555');

      const wrong = await confirm('000000');
      expect(wrong.status).toBe(400);

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.phone).toBeNull();
    });

    it('burns the code after too many wrong guesses', async () => {
      await start('+211920000666');
      const code = sms.lastCode();

      for (let i = 0; i < 5; i++) await confirm('000000');

      // Even the right code is no good now: the challenge is spent.
      const late = await confirm(code);
      expect(late.status).toBe(400);
      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.phone).toBeNull();
    });

    it('refuses something that is not a phone number, before spending anything', async () => {
      const bad = await start('not a number at all');
      expect(bad.status).toBe(400);
      expect(sms.sent).toHaveLength(0);
    });

    it('refuses a bare local number with no country code and no leading zero', async () => {
      // `920000777` is a valid South Sudanese subscriber number and the opening of numbers in a
      // dozen other countries. Guessing would send the Authority's business abroad.
      const bad = await start('920000777');
      expect(bad.status).toBe(400);
      expect(sms.sent).toHaveLength(0);
    });

    it('does not confirm a number when the text could not be sent', async () => {
      sms.failWith = 'Insufficient balance.';

      const failed = await start('+211920000888');
      expect(failed.status).toBe(422);
      expect(failed.body.message).toBe(
        'We could not send a code to that number. Check it and try again.',
      );
      // The gateway's own wording is a fact about the Authority's SMS account. It belongs in the
      // log, which is where it goes, and not in an answer to an operator filing a return.
      expect(JSON.stringify(failed.body)).not.toContain('Insufficient balance');

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after!.phone).toBeNull();
    });

    it('issues nothing at all when there is no gateway', async () => {
      // The screen is told up front by GET /auth/phone whether confirming is possible, so this is
      // the backstop for the race where the gateway is switched off mid-session.
      sms.configured = false;

      const unavailable = await start('+211920000999');
      expect(unavailable.status).toBe(503);
      // Nothing was issued. A code sent nowhere leaves the user staring at a box they can never
      // fill in, and a half-finished challenge in the database.
      expect(await prisma.phoneVerification.count({ where: { userId } })).toBe(0);
      expect(sms.sent).toHaveLength(0);
    });

    it('caps how many codes one account can ask for in an hour', async () => {
      // Each of these costs the Authority money and rings a handset. Without the cap an account is
      // a way to spend the balance, or to keep one person's phone busy all night.
      for (let i = 0; i < 5; i++) {
        expect((await start(`+21192000${1000 + i}`)).status).toBe(201);
      }
      const sixth = await start('+211920001100');
      expect(sixth.status).toBe(409);
      expect(sms.sent).toHaveLength(5);
    });

    it('lets nobody near this without signing in', async () => {
      const anonymous = await request(server)
        .post('/api/v1/auth/phone')
        .send({ phone: '+211920000000' });
      expect(anonymous.status).toBe(401);
    });
  });
});
