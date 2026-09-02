import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role, SubmissionStatus, TemplateStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** Aggregated analytics over returns, scope-aware (Q14). Data is seeded directly for determinism. */
describe('Analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-an-admin@nca.test';
  const opAEmail = 'e2e-an-a@x.test';
  const opBEmail = 'e2e-an-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/ANA', 'E2E/ANB'];
  const tplName = 'E2E Analytics Template';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let templateId: string;

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
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: licences } } });
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
        name: 'An A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'An B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    const opA = await prisma.user.create({
      data: {
        email: opAEmail,
        passwordHash,
        firstName: 'A',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    const opB = await prisma.user.create({
      data: {
        email: opBEmail,
        passwordHash,
        firstName: 'B',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entB.id,
      },
    });

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    templateId = tpl.id;
    const p1 = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2026 Q1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2026-04-15'),
        status: 'CLOSED',
      },
    });
    const p2 = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2026 Q2',
        periodStart: new Date('2026-04-01'),
        periodEnd: new Date('2026-06-30'),
        dueDate: new Date('2026-07-15'),
        status: 'OPEN',
      },
    });

    // Entity A: an approved on-time return on p1, and a rejected late return on p2.
    const mk = (over: Record<string, unknown>) => ({
      entityId: entA.id,
      periodId: p1.id,
      templateId: tpl.id,
      createdById: opA.id,
      ...over,
    });
    await prisma.submission.create({
      data: mk({
        periodId: p1.id,
        status: SubmissionStatus.APPROVED,
        isLate: false,
        submittedAt: new Date('2026-04-10'),
        referenceNumber: 'NCA/SUB/2026/900001',
      }),
    });
    await prisma.submission.create({
      data: mk({
        periodId: p2.id,
        status: SubmissionStatus.REJECTED,
        isLate: true,
        submittedAt: new Date('2026-07-20'),
        referenceNumber: 'NCA/SUB/2026/900002',
      }),
    });
    // Entity B: one approved on-time return on p1.
    await prisma.submission.create({
      data: {
        entityId: entB.id,
        periodId: p1.id,
        templateId: tpl.id,
        createdById: opB.id,
        status: SubmissionStatus.APPROVED,
        isLate: false,
        submittedAt: new Date('2026-04-12'),
        referenceNumber: 'NCA/SUB/2026/900003',
      },
    });

    adminToken = await login(adminEmail);
    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  // Scope every read to this suite's template so parallel suites' data can't perturb the counts.
  const summary = async (token: string) =>
    (
      await request(server)
        .get('/api/v1/analytics/summary')
        .query({ templateId })
        .set(auth(token))
        .expect(200)
    ).body;

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/analytics/summary').expect(401);
  });

  it('scopes an operator summary to their own entity', async () => {
    const a = await summary(opAToken);
    expect(a.submissions.approved).toBe(1);
    expect(a.submissions.rejected).toBe(1);
    expect(a.timeliness).toEqual({ onTime: 1, late: 1 });
    expect(a.approvalRate).toBeCloseTo(0.5);

    // Operator B sees only its own single approved return — never A's figures.
    const b = await summary(opBToken);
    expect(b.submissions.approved).toBe(1);
    expect(b.submissions.rejected).toBe(0);
    expect(b.approvalRate).toBe(1);
  });

  it('aggregates across all entities for the Authority', async () => {
    const all = await summary(adminToken);
    expect(all.submissions.approved).toBe(2); // A + B
    expect(all.submissions.rejected).toBe(1);
    expect(all.timeliness).toEqual({ onTime: 2, late: 1 });
  });

  it('returns a per-period trend series, oldest first, scoped to the reader', async () => {
    const res = await request(server)
      .get('/api/v1/analytics/trends')
      .query({ periods: 8, templateId })
      .set(auth(opAToken))
      .expect(200);
    const labels = res.body.periods.map((p: { label: string }) => p.label);
    expect(labels).toEqual(['2026 Q1', '2026 Q2']);
    const q1 = res.body.periods.find((p: { label: string }) => p.label === '2026 Q1');
    expect(q1).toMatchObject({ filed: 1, onTime: 1, late: 0, approved: 1 });
    const q2 = res.body.periods.find((p: { label: string }) => p.label === '2026 Q2');
    expect(q2).toMatchObject({ filed: 1, onTime: 0, late: 1, rejected: 1 });
  });
});
