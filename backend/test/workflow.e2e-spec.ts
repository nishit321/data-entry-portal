import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role, TemplateStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** The Checker → Verifier → Approver review workflow over real HTTP (Q1/Q2). */
describe('Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const opEmail = 'e2e-wf-op@x.test';
  const checkerEmail = 'e2e-wf-checker@nca.test';
  const verifierEmail = 'e2e-wf-verifier@nca.test';
  const approverEmail = 'e2e-wf-approver@nca.test';
  const emails = [opEmail, checkerEmail, verifierEmail, approverEmail];
  const licence = 'E2E/WF';
  const tplName = 'E2E Workflow Template';

  let opToken: string;
  let checkerToken: string;
  let verifierToken: string;
  let approverToken: string;
  let entityId: string;
  let nameFieldId: string;
  let subsFieldId: string;
  let p3SubmissionId: string;
  const periodIds: string[] = [];

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
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: licence } } });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: licence } });
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
    const entity = await prisma.entity.create({
      data: {
        name: 'WF Op',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    entityId = entity.id;
    await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Op',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    for (const [email, role] of [
      [checkerEmail, Role.CHECKER],
      [verifierEmail, Role.VERIFIER],
      [approverEmail, Role.APPROVER],
    ] as const) {
      await prisma.user.create({
        data: { email, passwordHash, firstName: role, lastName: 'NCA', role },
      });
    }

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: [
            {
              key: 'general',
              title: 'General',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'QUARTERLY_AND_ANNUAL',
              fields: {
                create: [
                  { key: 'op_name', label: 'Name', order: 1, dataType: 'TEXT', isMandatory: true },
                  { key: 'subs', label: 'Subscribers', order: 2, dataType: 'INTEGER' },
                ],
              },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    nameFieldId = tpl.sections[0].fields.find((f) => f.key === 'op_name')!.id;
    subsFieldId = tpl.sections[0].fields.find((f) => f.key === 'subs')!.id;

    // Three open periods so we can run independent submissions (one return per entity+period).
    for (const label of ['2026 Q1', '2026 Q2', '2026 Q3']) {
      const p = await prisma.reportingPeriod.create({
        data: {
          templateId: tpl.id,
          frequency: 'QUARTERLY',
          label,
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-03-31'),
          dueDate: new Date('2999-04-15'),
          status: 'OPEN',
          openedAt: new Date(),
        },
      });
      periodIds.push(p.id);
    }

    opToken = await login(opEmail);
    checkerToken = await login(checkerEmail);
    verifierToken = await login(verifierEmail);
    approverToken = await login(approverEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Open a draft for a period, fill the mandatory field, submit, and return the submission id. */
  async function submitReturn(periodId: string): Promise<string> {
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opToken))
      .send({ periodId })
      .expect(201);
    const id = draft.body.id;
    await request(server)
      .put(`/api/v1/submissions/${id}/values`)
      .set(auth(opToken))
      .send({
        values: [
          { fieldId: nameFieldId, valueText: 'WF Operator' },
          { fieldId: subsFieldId, valueText: '100' },
        ],
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opToken))
      .send({ signedName: 'Op User' })
      .expect(201);
    return id;
  }

  const detail = async (id: string, token: string) =>
    (await request(server).get(`/api/v1/submissions/${id}`).set(auth(token)).expect(200)).body;

  const decide = (id: string, token: string, decision: string, comment?: string) =>
    request(server)
      .post(`/api/v1/workflow/${id}/decision`)
      .set(auth(token))
      .send({ decision, comment });

  it('routes a fresh submission to the Checker stage', async () => {
    const id = await submitReturn(periodIds[0]);
    const d = await detail(id, opToken);
    expect(d.status).toBe('SUBMITTED');
    expect(d.reviewStage).toBe('CHECKER');

    const queue = await request(server)
      .get('/api/v1/workflow/queue')
      .set(auth(checkerToken))
      .expect(200);
    expect(queue.body.data.some((s: { id: string }) => s.id === id)).toBe(true);
  });

  it('runs Checker then Verifier then Approver and locks on final approval', async () => {
    const id = await submitReturn(periodIds[1]);

    await decide(id, checkerToken, 'APPROVE', 'Looks complete').expect(201);
    expect((await detail(id, opToken)).reviewStage).toBe('VERIFIER');

    await decide(id, verifierToken, 'APPROVE').expect(201);
    expect((await detail(id, opToken)).reviewStage).toBe('APPROVER');

    const approved = await decide(id, approverToken, 'APPROVE').expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.reviewStage).toBeNull();
    expect(approved.body.lockedAt).not.toBeNull();
  });

  it('rejects a reviewer acting out of their stage, and requires a reason to reject', async () => {
    const id = await submitReturn(periodIds[2]);
    p3SubmissionId = id;
    // Verifier can't act while it's at the Checker stage.
    await decide(id, verifierToken, 'APPROVE').expect(400);
    // Operators can neither decide nor read the review history.
    await decide(id, opToken, 'APPROVE').expect(403);
    await request(server).get(`/api/v1/workflow/${id}/history`).set(auth(opToken)).expect(403);
    // A rejection needs a reason.
    await decide(id, checkerToken, 'REJECT').expect(400);
  });

  it('rejection returns the submission to the operator with a reason, and revise makes a new version', async () => {
    // The period-3 return from the previous test is still at the Checker stage — reject it here.
    const id = p3SubmissionId;
    await decide(id, checkerToken, 'REJECT', 'Subscriber figure looks wrong').expect(201);
    const rejected = await detail(id, opToken);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Subscriber figure looks wrong');

    const revised = await request(server)
      .post(`/api/v1/submissions/${id}/revise`)
      .set(auth(opToken))
      .expect(201);
    expect(revised.body.status).toBe('DRAFT');
    expect(revised.body.version).toBe(2);
    expect(revised.body.supersedesId).toBe(id);
    // Carried-forward answers are present.
    expect(revised.body.values.length).toBeGreaterThan(0);

    // The superseded (old rejected) version drops out of the list; only the current one shows.
    const list = await request(server)
      .get('/api/v1/submissions')
      .query({ pageSize: 100 })
      .set(auth(opToken))
      .expect(200);
    const ids = list.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(revised.body.id);
    expect(ids).not.toContain(id);
  });

  it('fast-tracks past the Checker when the clean streak is 3 or more (Q2)', async () => {
    // Seed a clean streak, then a fresh period + submission should skip the Checker.
    await prisma.complianceStreak.upsert({
      where: { entityId_templateName: { entityId, templateName: tplName } },
      create: { entityId, templateName: tplName, count: 3 },
      update: { count: 3 },
    });
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: (await prisma.reportingTemplate.findFirstOrThrow({ where: { name: tplName } }))
          .id,
        frequency: 'QUARTERLY',
        label: '2026 Q4',
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-12-31'),
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    const id = await submitReturn(period.id);
    expect((await detail(id, opToken)).reviewStage).toBe('VERIFIER');
  });
});
