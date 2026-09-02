import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EnforcementStatus,
  EntityStatus,
  EntityType,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(45000);
const OTP = '123456';
const DAY = 86_400_000;

/**
 * The penalty schedule and the enforcement automation it drives (Phase 2, Q3).
 *
 * Every assertion is scoped to this suite's own entities and period: the sweep and the accrual are
 * both global by design, so a count taken across the whole database would move whenever another
 * suite files a return.
 */
describe('Penalties and enforcement automation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-pen-admin@nca.test';
  const opEmail = 'e2e-pen-op@x.test';
  const emails = [adminEmail, opEmail];
  const licences = ['E2E/PEN/A', 'E2E/PEN/B'];
  const tplName = 'E2E Penalty Template';
  const ruleLabels = ['E2E general schedule', 'E2E MNO schedule', 'E2E future schedule'];

  let adminToken: string;
  let opToken: string;
  let entityAId: string;
  let entityBId: string;
  let periodId: string;
  let opUserId: string;
  let templateIdValue: string;

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const v = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return v.body.accessToken as string;
  }

  async function cleanup() {
    await prisma.enforcementCase.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: licences } } });
    // This suite's schedule is global, so it may have priced other suites' cases too. The FK is
    // deliberately RESTRICT in production (an amount must always trace back to the line that
    // produced it), so the reference is cleared here before the lines can go.
    await prisma.enforcementCase.updateMany({
      where: { penaltyRule: { label: { in: ruleLabels } } },
      data: { penaltyRuleId: null },
    });
    await prisma.penaltyRule.deleteMany({ where: { label: { in: ruleLabels } } });
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
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NCA',
        role: Role.ADMIN,
      },
    });
    const entA = await prisma.entity.create({
      data: {
        name: 'Pen A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Pen B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    entityAId = entA.id;
    entityBId = entB.id;
    const op = await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Op',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    opUserId = op.id;

    // The schedule goes in before the period exists. The compliance sweep is global, so a parallel
    // suite can open this suite's cases at any moment; the only way the pricing is deterministic is
    // if there is a schedule in force before there is anything to price.
    await prisma.penaltyRule.create({
      data: {
        label: ruleLabels[0],
        fixedAmount: 20_000,
        dailyAmount: 1_000,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
    await prisma.penaltyRule.create({
      data: {
        label: ruleLabels[1],
        entityType: EntityType.MNO,
        fixedAmount: 50_000,
        dailyAmount: 5_000,
        maxAmount: 200_000,
        effectiveFrom: new Date('2020-01-01'),
      },
    });

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: {
            key: 'pen',
            title: 'Penalty section',
            order: 1,
            applicableEntityTypes: [EntityType.MNO],
          },
        },
      },
    });
    templateIdValue = tpl.id;

    // Due 20 days ago with a 5-day grace, so the default began 15 days ago.
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2026 Q1 penalty',
        periodStart: new Date(Date.now() - 120 * DAY),
        periodEnd: new Date(Date.now() - 30 * DAY),
        dueDate: new Date(Date.now() - 20 * DAY),
        graceDays: 5,
        status: 'OPEN',
      },
    });
    periodId = period.id;

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Whole days of default elapsed, the same arithmetic the assessment uses. */
  const daysOfDefault = (startedAt: Date, until: Date = new Date()) =>
    Math.max(0, Math.floor((until.getTime() - startedAt.getTime()) / DAY));

  /** What the pricing test assessed, so later tests compare against it rather than a guess. */
  let expectedAmount = 0;

  /**
   * This suite's cases only. The sweep is global in both directions: it opens cases for other
   * suites' periods, and it opens cases against every active MNO for *this* suite's period. Only
   * the pair (our period, our entities) belongs to this suite.
   */
  const ourCases = () =>
    prisma.enforcementCase.findMany({
      where: { periodId, entityId: { in: [entityAId, entityBId] } },
      select: {
        id: true,
        entityId: true,
        status: true,
        penaltyAmount: true,
        penaltyDays: true,
        penaltyRuleId: true,
        defaultStartedAt: true,
        defaultEndedAt: true,
        resolutionNote: true,
      },
      orderBy: { entityId: 'asc' },
    });

  describe('the schedule', () => {
    it('requires authentication (401)', async () => {
      await request(server).get('/api/v1/penalty-schedule').expect(401);
    });

    it('refuses to create a line that charges nothing (400)', async () => {
      const res = await request(server)
        .post('/api/v1/penalty-schedule')
        .set(auth(adminToken))
        .send({ fixedAmount: 0, dailyAmount: 0, effectiveFrom: '2020-01-01' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('fixed amount');
    });

    it('refuses a cap below the fixed amount (400)', async () => {
      await request(server)
        .post('/api/v1/penalty-schedule')
        .set(auth(adminToken))
        .send({ fixedAmount: 100_000, maxAmount: 50_000, effectiveFrom: '2020-01-01' })
        .expect(400);
    });

    it('refuses an end date on or before the start (400)', async () => {
      await request(server)
        .post('/api/v1/penalty-schedule')
        .set(auth(adminToken))
        .send({ fixedAmount: 1000, effectiveFrom: '2026-01-01', effectiveTo: '2025-01-01' })
        .expect(400);
    });

    it('will not let an operator edit the schedule (403)', async () => {
      await request(server)
        .post('/api/v1/penalty-schedule')
        .set(auth(opToken))
        .send({ fixedAmount: 1, effectiveFrom: '2020-01-01' })
        .expect(403);
    });

    it('lets an operator read the schedule it is charged under', async () => {
      await request(server).get('/api/v1/penalty-schedule').set(auth(opToken)).expect(200);
    });

    it('creates a line, and lets it be renamed without restating the amounts', async () => {
      // A throwaway line, dated in the future so it prices none of this suite's cases.
      const created = await request(server)
        .post('/api/v1/penalty-schedule')
        .set(auth(adminToken))
        .send({
          label: ruleLabels[2],
          fixedAmount: 20_000,
          dailyAmount: 1_000,
          effectiveFrom: '2099-01-01',
        })
        .expect(201);
      expect(Number(created.body.fixedAmount)).toBe(20_000);

      // A partial update must not be judged as if it zeroed the amounts it did not send.
      const renamed = await request(server)
        .patch(`/api/v1/penalty-schedule/${created.body.id}`)
        .set(auth(adminToken))
        .send({ label: ruleLabels[2] })
        .expect(200);
      expect(Number(renamed.body.dailyAmount)).toBe(1_000);
    });
  });

  describe('pricing a case', () => {
    it('prices under the line for the operator type ahead of the general line', async () => {
      // Both lines are in force: a general one and a stricter MNO one. The MNO line must win.
      //
      // Closing the period sweeps that period alone. The global sweep would do the job too, but it
      // reaches into every other suite's overdue fixtures, and one of those may not have filed yet.
      await request(server)
        .post(`/api/v1/reporting-periods/${periodId}/close`)
        .set(auth(adminToken))
        .expect(201);

      const cases = await ourCases();
      expect(cases).toHaveLength(2); // one for each of this suite's entities
      for (const c of cases) {
        expect(c.status).toBe(EnforcementStatus.OPEN);
        expect(c.defaultStartedAt).not.toBeNull();

        // The grace window is five *working* days (Q3), so how many calendar days of default have
        // elapsed depends on which weekday the deadline fell on. That calendar is the timeline
        // util's business and is tested there; what this suite owns is that the amount follows
        // from the days, under the MNO line rather than the general one.
        const days = daysOfDefault(c.defaultStartedAt!);
        expect(c.penaltyDays).toBe(days);
        expect(Number(c.penaltyAmount)).toBe(50_000 + days * 5_000);
        // The general line would have charged far less, so the MNO line clearly won.
        expect(Number(c.penaltyAmount)).toBeGreaterThan(20_000 + days * 1_000);
      }
      expectedAmount = Number(cases[0].penaltyAmount);
    });

    it('shows an operator the amount and the line it was priced under', async () => {
      const res = await request(server)
        .get('/api/v1/enforcement')
        .query({ periodId })
        .set(auth(opToken))
        .expect(200);
      const row = res.body.data.find((c: { entity: { id: string } }) => c.entity.id === entityAId);
      expect(Number(row.penaltyAmount)).toBe(expectedAmount);
      expect(row.penaltyRule.label).toBe(ruleLabels[1]);
      expect(Number(row.penaltyRule.dailyAmount)).toBe(5_000);
    });
  });

  describe('the nightly accrual', () => {
    it('closes a case by itself once the missing return arrives, freezing the amount', async () => {
      // Entity A files, 5 days into its default rather than today.
      const filedAt = new Date(Date.now() - 10 * DAY);
      await prisma.submission.create({
        data: {
          entityId: entityAId,
          periodId,
          templateId: templateIdValue,
          createdById: opUserId,
          status: SubmissionStatus.SUBMITTED,
          isLate: true,
          submittedAt: filedAt,
          referenceNumber: 'NCA/SUB/2026/930001',
        },
      });

      const res = await request(server)
        .post('/api/v1/enforcement/accrue')
        .set(auth(adminToken))
        .expect(201);
      expect(res.body.closed).toBeGreaterThanOrEqual(1);

      const cases = await ourCases();
      const a = cases.find((c) => c.entityId === entityAId)!;
      expect(a.status).toBe(EnforcementStatus.RESOLVED);
      expect(a.defaultEndedAt).not.toBeNull();

      // The meter stopped the day the return arrived, not the day the job noticed.
      const daysToFiling = daysOfDefault(a.defaultStartedAt!, filedAt);
      expect(a.penaltyDays).toBe(daysToFiling);
      expect(Number(a.penaltyAmount)).toBe(50_000 + daysToFiling * 5_000);
      expect(a.resolutionNote).toContain('Closed automatically');
      // Which is less than it would have been had it kept running to today.
      expect(daysToFiling).toBeLessThan(daysOfDefault(a.defaultStartedAt!));

      // Entity B never filed, so its case stays open and still carries the full amount.
      const b = cases.find((c) => c.entityId === entityBId)!;
      expect(b.status).toBe(EnforcementStatus.OPEN);
      expect(Number(b.penaltyAmount)).toBe(expectedAmount);
    });

    it('is idempotent: a second run does not re-price a case it has already closed', async () => {
      const before = await ourCases();
      await request(server).post('/api/v1/enforcement/accrue').set(auth(adminToken)).expect(201);
      const after = await ourCases();

      const pick = (rows: typeof before, id: string) => rows.find((c) => c.entityId === id)!;
      expect(Number(pick(after, entityAId).penaltyAmount)).toBe(
        Number(pick(before, entityAId).penaltyAmount),
      );
      expect(pick(after, entityAId).status).toBe(EnforcementStatus.RESOLVED);
    });

    it('will not let an operator run the accrual (403)', async () => {
      await request(server).post('/api/v1/enforcement/accrue').set(auth(opToken)).expect(403);
    });
  });

  describe('retiring a line', () => {
    it('removes it from the schedule without erasing what it priced', async () => {
      const list = await request(server)
        .get('/api/v1/penalty-schedule')
        .set(auth(adminToken))
        .expect(200);
      const mno = list.body.find((r: { label: string }) => r.label === ruleLabels[1]);

      await request(server)
        .delete(`/api/v1/penalty-schedule/${mno.id}`)
        .set(auth(adminToken))
        .expect(200);

      const after = await request(server)
        .get('/api/v1/penalty-schedule')
        .set(auth(adminToken))
        .expect(200);
      expect(after.body.map((r: { id: string }) => r.id)).not.toContain(mno.id);

      // The case it priced still points at it, so the amount can still be explained.
      const cases = await ourCases();
      expect(cases.every((c) => c.penaltyRuleId === mno.id)).toBe(true);
    });
  });
});
