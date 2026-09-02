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

/** Revenue-levy: rate configuration (ADMIN) and revenue-based assessments over approved returns. */
describe('Levy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-lv-admin@nca.test';
  const opAEmail = 'e2e-lv-a@x.test';
  const opBEmail = 'e2e-lv-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/LVA', 'E2E/LVB'];
  const tplName = 'E2E Levy Template';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let entityAId: string;
  let periodId: string;

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
    await prisma.levyRate.deleteMany({ where: { label: 'E2E levy' } });
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
        name: 'Levy A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Levy B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    entityAId = entA.id;
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
        sections: {
          create: [
            {
              key: 'financials',
              title: 'Financials',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'ANNUAL',
              fields: {
                create: [
                  {
                    key: 'total_revenue',
                    label: 'Total annual revenue',
                    order: 1,
                    dataType: 'MONETARY',
                    isLevyBasis: true,
                  },
                ],
              },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    const revFieldId = tpl.sections[0].fields[0].id;

    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'ANNUAL',
        label: 'FY2026',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-12-31'),
        dueDate: new Date('2027-02-28'),
        status: 'CLOSED',
      },
    });
    periodId = period.id;

    // Approved returns with reported revenue: A = 2,000,000 SSP; B = 1,000,000 SSP.
    for (const [ent, op, revenue, ref] of [
      [entA.id, opA.id, '2000000', 'NCA/SUB/2027/910001'],
      [entB.id, opB.id, '1000000', 'NCA/SUB/2027/910002'],
    ] as const) {
      await prisma.submission.create({
        data: {
          entityId: ent,
          periodId: period.id,
          templateId: tpl.id,
          createdById: op,
          status: SubmissionStatus.APPROVED,
          isLate: false,
          submittedAt: new Date('2027-02-20'),
          referenceNumber: ref,
          values: { create: [{ fieldId: revFieldId, valueText: revenue }] },
        },
      });
    }

    adminToken = await login(adminEmail);
    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/levy/assessments').expect(401);
  });

  it('lets only an admin configure levy rates', async () => {
    await request(server)
      .post('/api/v1/levy/rates')
      .set(auth(opAToken))
      .send({ ratePercent: 2.5, effectiveFrom: '2026-01-01' })
      .expect(403);

    const created = await request(server)
      .post('/api/v1/levy/rates')
      .set(auth(adminToken))
      .send({ ratePercent: 2.5, effectiveFrom: '2026-01-01', label: 'E2E levy' })
      .expect(201);
    expect(Number(created.body.ratePercent)).toBe(2.5);

    // An end date before the start is rejected.
    await request(server)
      .post('/api/v1/levy/rates')
      .set(auth(adminToken))
      .send({ ratePercent: 1, effectiveFrom: '2026-06-01', effectiveTo: '2026-01-01' })
      .expect(400);

    const list = await request(server).get('/api/v1/levy/rates').set(auth(adminToken)).expect(200);
    expect(list.body.some((r: { label: string }) => r.label === 'E2E levy')).toBe(true);
    // Operators cannot read the rate schedule.
    await request(server).get('/api/v1/levy/rates').set(auth(opAToken)).expect(403);
  });

  it('assesses each operator revenue at the applicable rate (Authority sees all)', async () => {
    const res = await request(server)
      .get('/api/v1/levy/assessments')
      .query({ periodId })
      .set(auth(adminToken))
      .expect(200);

    expect(res.body.levyBasisConfigured).toBe(true);
    expect(Number(res.body.rate.ratePercent)).toBe(2.5);
    expect(res.body.totals.operatorsAssessed).toBe(2);
    expect(res.body.totals.totalRevenue).toBe(3000000);
    // 3,000,000 × 2.5% = 75,000.
    expect(res.body.totals.totalLevyDue).toBe(75000);

    const a = res.body.rows.find((r: { entity: { id: string } }) => r.entity.id === entityAId);
    expect(a.assessableRevenue).toBe(2000000);
    expect(a.levyDue).toBe(50000); // 2,000,000 × 2.5%
  });

  it('scopes an operator to their own assessment only', async () => {
    const res = await request(server)
      .get('/api/v1/levy/assessments')
      .query({ periodId })
      .set(auth(opAToken))
      .expect(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].entity.id).toBe(entityAId);
    expect(res.body.rows[0].levyDue).toBe(50000);

    const b = await request(server)
      .get('/api/v1/levy/assessments')
      .query({ periodId })
      .set(auth(opBToken))
      .expect(200);
    expect(b.body.rows).toHaveLength(1);
    expect(b.body.rows[0].entity.id).not.toBe(entityAId);
    expect(b.body.totals.totalLevyDue).toBe(25000); // 1,000,000 × 2.5%
  });
});
