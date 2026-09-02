import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  FieldType,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/**
 * The trend/anomaly sweep (Phase 2). A five-quarter history is seeded directly so the arithmetic is
 * deterministic: entity A reports a steady 100 then jumps to 400, entity B stays flat throughout.
 */
describe('Analytics anomalies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-anom-admin@nca.test';
  const opAEmail = 'e2e-anom-a@x.test';
  const opBEmail = 'e2e-anom-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/ANOMA', 'E2E/ANOMB'];
  const tplName = 'E2E Anomaly Template';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let templateId: string;
  let entAId: string;

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
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { in: licences } } } },
    });
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
        name: 'Anom A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    entAId = entA.id;
    const entB = await prisma.entity.create({
      data: {
        name: 'Anom B',
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
        sections: {
          create: {
            key: 'traffic',
            title: 'Traffic',
            order: 1,
            fields: {
              create: [
                {
                  key: 'voice_minutes',
                  label: 'Voice minutes',
                  order: 1,
                  dataType: FieldType.INTEGER,
                  unit: 'minutes',
                },
                // A text field in the same section, to prove the sweep leaves prose alone.
                { key: 'commentary', label: 'Commentary', order: 2, dataType: FieldType.TEXT },
                // Reported once only, so it has no history to be judged against.
                {
                  key: 'new_metric',
                  label: 'New metric',
                  order: 3,
                  dataType: FieldType.INTEGER,
                },
              ],
            },
          },
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    templateId = tpl.id;
    const numericField = tpl.sections[0].fields.find((f) => f.key === 'voice_minutes')!;
    const textField = tpl.sections[0].fields.find((f) => f.key === 'commentary')!;
    const newField = tpl.sections[0].fields.find((f) => f.key === 'new_metric')!;

    // Five quarters of history. Q1-Q4 are approved and form the baseline; Q5 is the figure judged.
    const quarters = [1, 2, 3, 4, 5].map((n) => ({
      label: `2025 Q${n}`,
      periodStart: new Date(Date.UTC(2025, (n - 1) * 3, 1)),
      periodEnd: new Date(Date.UTC(2025, n * 3, 0)),
      dueDate: new Date(Date.UTC(2025, n * 3, 15)),
    }));
    const periods: { id: string; dueDate: Date }[] = [];
    for (const q of quarters) {
      periods.push(
        await prisma.reportingPeriod.create({
          data: {
            templateId: tpl.id,
            frequency: 'QUARTERLY',
            label: q.label,
            periodStart: q.periodStart,
            periodEnd: q.periodEnd,
            dueDate: q.dueDate,
            status: 'CLOSED',
          },
        }),
      );
    }

    let ref = 910000;
    const file = async (
      entityId: string,
      createdById: string,
      index: number,
      value: number,
      status: SubmissionStatus,
      firstTimeValue?: number,
    ) => {
      await prisma.submission.create({
        data: {
          entityId,
          periodId: periods[index].id,
          templateId: tpl.id,
          createdById,
          status,
          isLate: false,
          submittedAt: periods[index].dueDate,
          referenceNumber: `NCA/SUB/2025/${++ref}`,
          values: {
            create: [
              { fieldId: numericField.id, valueText: String(value) },
              { fieldId: textField.id, valueText: 'Nothing unusual to report this quarter.' },
              ...(firstTimeValue === undefined
                ? []
                : [{ fieldId: newField.id, valueText: String(firstTimeValue) }]),
            ],
          },
        },
      });
    };

    // Entity A: flat at 100 for four approved quarters, then 400 filed and awaiting review.
    await file(entA.id, opA.id, 0, 100, SubmissionStatus.APPROVED);
    await file(entA.id, opA.id, 1, 100, SubmissionStatus.APPROVED);
    await file(entA.id, opA.id, 2, 100, SubmissionStatus.APPROVED);
    await file(entA.id, opA.id, 3, 100, SubmissionStatus.APPROVED);
    await file(entA.id, opA.id, 4, 400, SubmissionStatus.UNDER_REVIEW, 77);

    // Entity B: steady throughout, so nothing to say about it.
    await file(entB.id, opB.id, 0, 500, SubmissionStatus.APPROVED);
    await file(entB.id, opB.id, 1, 505, SubmissionStatus.APPROVED);
    await file(entB.id, opB.id, 2, 495, SubmissionStatus.APPROVED);
    await file(entB.id, opB.id, 3, 500, SubmissionStatus.APPROVED);
    await file(entB.id, opB.id, 4, 560, SubmissionStatus.APPROVED);

    adminToken = await login(adminEmail);
    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  // Every read is scoped to this suite's template, so other suites' data cannot move the counts.
  const sweep = async (token: string, query: Record<string, unknown> = {}) =>
    (
      await request(server)
        .get('/api/v1/analytics/anomalies')
        .query({ templateId, ...query })
        .set(auth(token))
        .expect(200)
    ).body;

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/analytics/anomalies').expect(401);
  });

  it('flags the operator whose figure jumped, and says by how much', async () => {
    const body = await sweep(adminToken);
    expect(body.total).toBe(1);
    expect(body.high).toBe(1);
    expect(body.thresholdPercent).toBe(50);

    const row = body.rows[0];
    expect(row.entity.name).toBe('Anom A');
    expect(row.period.label).toBe('2025 Q5');
    expect(row.field.key).toBe('voice_minutes');
    expect(row.status).toBe(SubmissionStatus.UNDER_REVIEW);
    expect(row.anomaly).toMatchObject({
      kind: 'SPIKE',
      severity: 'HIGH',
      value: 400,
      baseline: 100,
      changePercent: 300,
    });
    expect(row.submissionId).toEqual(expect.any(String));
  });

  it('says nothing about an operator whose figures are steady', async () => {
    const body = await sweep(opBToken);
    expect(body.total).toBe(0);
    expect(body.rows).toEqual([]);
  });

  it('shows an operator the flag raised on their own return, and only that', async () => {
    const body = await sweep(opAToken);
    expect(body.total).toBe(1);
    expect(body.rows[0].entity.id).toBe(entAId);

    // The entityId filter is advisory for an operator: asking for someone else's figures
    // still returns their own.
    const bodyB = await sweep(opBToken, { entityId: entAId });
    expect(bodyB.rows).toEqual([]);
  });

  it('leaves text answers out of the sweep', async () => {
    const body = await sweep(adminToken);
    const keys = body.rows.map((r: { field: { key: string } }) => r.field.key);
    expect(keys).not.toContain('commentary');
  });

  it('narrows the view to one entity for an Authority reader', async () => {
    const body = await sweep(adminToken, { entityId: entAId });
    expect(body.total).toBe(1);
    expect(body.rows[0].entity.id).toBe(entAId);
  });

  it('filters by severity', async () => {
    const high = await sweep(adminToken, { severity: 'HIGH' });
    expect(high.total).toBe(1);
    const medium = await sweep(adminToken, { severity: 'MEDIUM' });
    expect(medium.total).toBe(0);
  });

  it('widens the net when the threshold is lowered', async () => {
    // Entity B moves by 12% against its baseline of 500, invisible at the default threshold.
    const body = await sweep(adminToken, { thresholdPercent: 10 });
    const names = body.rows.map((r: { entity: { name: string } }) => r.entity.name);
    expect(names).toContain('Anom B');
    expect(body.total).toBe(2);
    // Worst first: A's 300% jump outranks B's 12% drift.
    expect(body.rows[0].entity.name).toBe('Anom A');
  });

  it('keeps first-time figures out of the sweep unless they are asked for', async () => {
    const quiet = await sweep(adminToken);
    expect(quiet.rows.map((r: { field: { key: string } }) => r.field.key)).not.toContain(
      'new_metric',
    );

    const withFirst = await sweep(adminToken, { includeFirstReports: true });
    const first = withFirst.rows.find(
      (r: { field: { key: string } }) => r.field.key === 'new_metric',
    );
    expect(first.anomaly).toMatchObject({
      kind: 'FIRST_REPORT',
      severity: 'MEDIUM',
      value: 77,
      baseline: null,
      baselineSize: 0,
    });
  });

  it('flags a slow drift no single period reveals (Phase 3)', async () => {
    const body = await sweep(adminToken, { includeFirstReports: true });
    // Entity B climbs 500, 505, 495, 500, 560 - never a large step, and only four approved figures
    // behind the latest, which is under the statistical layer's minimum history. So nothing here.
    const bRow = body.rows.find(
      (r: { entity: { name: string }; field: { key: string } }) =>
        r.entity.name === 'Anom B' && r.field.key === 'voice_minutes',
    );
    expect(bRow).toBeUndefined();
  });

  it('carries the statistical view alongside the threshold flag', async () => {
    const body = await sweep(adminToken);
    const row = body.rows.find((r: { entity: { name: string } }) => r.entity.name === 'Anom A');
    // Four approved periods is below the statistical layer's minimum, so it has no view to offer
    // and says so by being absent rather than by guessing.
    expect(row.anomaly.kind).toBe('SPIKE');
    expect(row.statistical ?? null).toBeNull();
  });

  it('rejects a threshold outside the accepted range (400)', async () => {
    await request(server)
      .get('/api/v1/analytics/anomalies')
      .query({ thresholdPercent: 5000 })
      .set(auth(adminToken))
      .expect(400);
  });
});
