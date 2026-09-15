import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(120000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';

/**
 * Formal enforcement orders — Tier 3's non-financial sanctions (NCA, 3 September 2026).
 *
 * NCA's instruction is the specification, so it is quoted rather than paraphrased: *"record as a
 * formal enforcement order on the case — type (suspension full/partial, cancellation, or
 * licence-shortening), reason, legal basis, effective date and duration. Sign-off escalates beyond
 * the officer chain: DG approves a suspension; the Board approves a cancellation."*
 *
 * These are the sharpest routes in the system. A waived penalty cancels money; an approved
 * suspension ends an operator's right to trade. So the tests are about **who may sign what**, and
 * about the order carrying enough to be defended — a suspension whose file cannot say why, under
 * which section, and on whose authority is not one an operator can answer or a court can read.
 */
describe('enforcement orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const LICENCE = 'ORDERS/A';
  const EMAILS = ['orders-admin@x.test', 'orders-dg@x.test', 'orders-analyst@x.test'];
  let adminToken: string;
  let dgToken: string;
  let analystToken: string;
  let caseId: string;

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const verified = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return verified.body.accessToken as string;
  }

  async function cleanup() {
    const entities = await prisma.entity.findMany({
      where: { licenceNumber: LICENCE },
      select: { id: true },
    });
    const ids = entities.map((e) => e.id);
    if (ids.length) await prisma.enforcementCase.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'orders-' } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: LICENCE } });
    await prisma.reportingPeriod.deleteMany({ where: { label: { startsWith: 'ORDERS ' } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: { startsWith: 'ORDERS ' } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();
    const passwordHash = await hashPassword(PASSWORD);
    /*
     * `VENDOR`, and a template that applies to it alone.
     *
     * The compliance sweep is global and opens a case against every active operator a period's
     * template covers, so a fixture built on a shared type would reach into other suites. See the
     * flake rules in the audit-coverage spec.
     */
    const entity = await prisma.entity.create({
      data: {
        name: 'Orders Telecom',
        type: EntityType.VENDOR,
        status: EntityStatus.ACTIVE,
        licenceNumber: LICENCE,
      },
    });

    for (const [email, role] of [
      [EMAILS[0]!, Role.ADMIN],
      [EMAILS[1]!, Role.SUPERVISOR],
      [EMAILS[2]!, Role.ANALYST],
    ] as [string, Role][]) {
      await prisma.user.create({
        data: { email, passwordHash, firstName: 'Orders', lastName: role, role },
      });
    }
    adminToken = await login(EMAILS[0]!);
    dgToken = await login(EMAILS[1]!);
    analystToken = await login(EMAILS[2]!);

    // A case to hang orders on, planted directly: how a case comes to exist is the sweep's
    // business and is covered by its own spec.
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: (
          await prisma.reportingTemplate.create({
            data: { name: 'ORDERS template', version: 1 },
          })
        ).id,
        frequency: 'QUARTERLY',
        label: 'ORDERS 2027 Q1',
        periodStart: new Date('2027-01-01'),
        periodEnd: new Date('2027-03-31'),
        dueDate: new Date('2027-04-15'),
      },
    });
    const opened = await prisma.enforcementCase.create({
      data: {
        entityId: entity.id,
        periodId: period.id,
        note: 'Fixture for the order tests.',
        defaultStartedAt: new Date('2027-04-20'),
      },
    });
    caseId = opened.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const draft = (over: Record<string, unknown> = {}, token = adminToken) =>
    request(server)
      .post(`/api/v1/enforcement/${caseId}/orders`)
      .set(auth(token))
      .send({
        type: 'SUSPENSION_PARTIAL',
        reason: 'Quality of service below the licensed threshold for two consecutive quarters.',
        legalBasis: 'Section 42(3)',
        effectiveFrom: '2027-06-01',
        durationDays: 90,
        ...over,
      });

  describe('what an order has to carry', () => {
    it('records the type, reason, legal basis, effective date and duration', async () => {
      // Exactly the five NCA named. An order missing any of them is not one an operator can
      // answer or a court can read.
      const res = await draft();
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        type: 'SUSPENSION_PARTIAL',
        legalBasis: 'Section 42(3)',
        durationDays: 90,
        status: 'DRAFT',
      });
      expect(res.body.reason).toContain('Quality of service');
      expect(res.body.effectiveFrom).toBeTruthy();
      expect(res.body.draftedBy.id).toBeTruthy();
    });

    it.each([
      ['reason', { reason: '' }],
      ['legal basis', { legalBasis: '' }],
      ['effective date', { effectiveFrom: undefined }],
    ])('refuses one with no %s', async (_name, over) => {
      const res = await draft(over);
      expect(res.status).toBe(400);
    });

    it('refuses a duration on a cancellation, which does not end', async () => {
      /*
       * "Cancelled for 90 days" is not a thing the Act provides for. Accepting it and quietly
       * ignoring the number would leave the file saying something nobody meant, for somebody to
       * interpret later.
       */
      const res = await draft({ type: 'CANCELLATION', durationDays: 90 });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('duration');
    });

    it('insists on a duration for a suspension, which does', async () => {
      const res = await draft({ durationDays: undefined });
      expect(res.status).toBe(400);
    });
  });

  describe('who may sign it', () => {
    it('has no effect at all until it is approved', async () => {
      // Drafting is not deciding. An order that took effect the moment an officer typed it would
      // make the escalated sign-off decorative.
      const res = await draft();
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.approvedAt).toBeNull();
      expect(res.body.approvedBy).toBeNull();
    });

    it('will not let the officer who drafted it approve it', async () => {
      /*
       * The point of escalating sign-off is that a second person looked. One account doing both is
       * the officer chain again with a different label on it, and it is the first thing anybody
       * reviewing a contested suspension would check.
       */
      const drafted = await draft();
      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(adminToken))
        .send({});
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('drafted');
    });

    it('lets the Director General approve a suspension', async () => {
      const drafted = await draft();
      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(dgToken))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approvedBy.id).toBeTruthy();
      expect(res.body.approvedAt).toBeTruthy();
    });

    it('keeps an analyst out entirely', async () => {
      const drafted = await draft();
      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(analystToken))
        .send({});
      expect(res.status).toBe(403);
    });

    it('will not approve a cancellation without the Board minute that authorised it', async () => {
      /*
       * The Board is a body that meets and minutes its decisions; it does not hold a login. Giving
       * it one would put the Authority's most serious sanction behind a shared password and record
       * whichever officer typed it as the person who decided. So what is required is the minute.
       */
      const drafted = await draft({ type: 'CANCELLATION', durationDays: undefined });
      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(dgToken))
        .send({});
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('Board');
    });

    it('approves a cancellation once the minute is recorded', async () => {
      const drafted = await draft({ type: 'CANCELLATION', durationDays: undefined });
      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(dgToken))
        .send({ boardMinuteRef: 'BM/2027/014', boardDecidedAt: '2027-05-20' });
      expect(res.status).toBe(200);
      expect(res.body.boardMinuteRef).toBe('BM/2027/014');
      expect(res.body.boardDecidedAt).toBeTruthy();
      // And the officer who entered it is still named. Who decided and who recorded are two
      // different facts, and both are needed.
      expect(res.body.approvedBy.id).toBeTruthy();
    });

    it('refuses to approve the same order twice', async () => {
      const drafted = await draft();
      await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(dgToken))
        .send({})
        .expect(200);
      const again = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(dgToken))
        .send({});
      expect(again.status).toBe(400);
    });
  });

  describe('withdrawing one', () => {
    it('keeps the order, marked withdrawn, rather than deleting it', async () => {
      // It had legal effect while it stood. A file that shows no trace of a suspension that was
      // served and later lifted is not a record of what happened.
      const drafted = await draft();
      await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/approve`)
        .set(auth(dgToken))
        .send({})
        .expect(200);

      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/revoke`)
        .set(auth(adminToken))
        .send({ note: 'Withdrawn: service restored within the notice period.' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REVOKED');
      expect(res.body.revokedNote).toContain('service restored');
      expect(res.body.approvedAt).toBeTruthy();
    });

    it('will not withdraw one that never took effect', async () => {
      const drafted = await draft();
      const res = await request(server)
        .patch(`/api/v1/enforcement/orders/${drafted.body.id}/revoke`)
        .set(auth(adminToken))
        .send({ note: 'Changed our minds.' });
      expect(res.status).toBe(400);
    });
  });

  describe('who may read one', () => {
    it('lists every order on the case, newest first', async () => {
      const res = await request(server)
        .get(`/api/v1/enforcement/${caseId}/orders`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      const dates = (res.body as { createdAt: string }[]).map((o) => o.createdAt);
      expect([...dates].sort().reverse()).toEqual(dates);
    });

    it('is closed to somebody not signed in', async () => {
      await request(server).get(`/api/v1/enforcement/${caseId}/orders`).expect(401);
    });
  });
});
