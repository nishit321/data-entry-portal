import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  Role,
  RuleSeverity,
  RuleType,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** Submission lifecycle over real HTTP: draft → values → submit, with validation and segregation. */
describe('Submissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const emails = ['e2e-sub-a@x.test', 'e2e-sub-b@x.test', 'e2e-sub-s@x.test'];
  const licences = ['E2E/SUBA', 'E2E/SUBB', 'E2E/SUBS'];
  const tplName = 'E2E Sub Template';

  let opAToken: string;
  let opBToken: string;
  let opSToken: string;
  let periodId: string;
  let nameFieldId: string;
  let subsFieldId: string;
  let activeFieldId: string;
  let tplId: string;

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
    const entA = await prisma.entity.create({
      data: {
        name: 'Sub A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Sub B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    await prisma.user.create({
      data: {
        email: emails[0],
        passwordHash,
        firstName: 'A',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    await prisma.user.create({
      data: {
        email: emails[1],
        passwordHash,
        firstName: 'B',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entB.id,
      },
    });
    // A suspended entity: its operator must not be able to transact at all.
    const entS = await prisma.entity.create({
      data: {
        name: 'Sub S',
        type: EntityType.MNO,
        status: EntityStatus.SUSPENDED,
        licenceNumber: licences[2],
      },
    });
    await prisma.user.create({
      data: {
        email: emails[2],
        passwordHash,
        firstName: 'S',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entS.id,
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
              key: 'general',
              title: 'General',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'QUARTERLY_AND_ANNUAL',
              fields: {
                create: [
                  { key: 'op_name', label: 'Name', order: 1, dataType: 'TEXT', isMandatory: true },
                  {
                    key: 'subs',
                    label: 'Subscribers',
                    order: 2,
                    dataType: 'INTEGER',
                    isMandatory: true,
                    flowOrStock: 'STOCK',
                  },
                  {
                    key: 'active',
                    label: 'Active Subscribers',
                    order: 3,
                    dataType: 'INTEGER',
                    flowOrStock: 'STOCK',
                  },
                ],
              },
            },
          ],
        },
        // Cross-field rule: active subscribers must not exceed total subscribers.
        rules: {
          create: [
            {
              type: RuleType.LESS_OR_EQUAL,
              severity: RuleSeverity.HARD,
              label: 'Active subscribers cannot exceed total subscribers',
              order: 1,
              config: { left: 'active', right: 'subs' },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    tplId = tpl.id;
    nameFieldId = tpl.sections[0].fields.find((f) => f.key === 'op_name')!.id;
    subsFieldId = tpl.sections[0].fields.find((f) => f.key === 'subs')!.id;
    activeFieldId = tpl.sections[0].fields.find((f) => f.key === 'active')!.id;

    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2026 Q1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2999-04-15'), // far future → on time
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    periodId = period.id;

    opAToken = await login(emails[0]);
    opBToken = await login(emails[1]);
    opSToken = await login(emails[2]);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/submissions').expect(401);
  });

  it('offers the open period as startable before anything is begun', async () => {
    const res = await request(server)
      .get('/api/v1/submissions/startable-periods')
      .set(auth(opAToken))
      .expect(200);
    expect(res.body.some((p: { id: string }) => p.id === periodId)).toBe(true);
  });

  it('runs draft then save then submit and issues a reference number', async () => {
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opAToken))
      .send({ periodId })
      .expect(201);
    expect(draft.body.status).toBe('DRAFT');
    const id = draft.body.id;

    await request(server)
      .put(`/api/v1/submissions/${id}/values`)
      .set(auth(opAToken))
      .send({
        values: [
          { fieldId: nameFieldId, valueText: 'Demo MNO' },
          { fieldId: subsFieldId, valueText: '1000' },
        ],
      })
      .expect(200);

    const submitted = await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opAToken))
      .send({ signedName: 'Grace Deng' })
      .expect(201);
    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.referenceNumber).toMatch(/^NCA\/SUB\/\d{4}\/\d{6}$/);
    expect(submitted.body.isLate).toBe(false);
    expect(submitted.body.signedName).toBe('Grace Deng');
  });

  it('filters submissions by status, timeliness, template, and submitted-date range', async () => {
    const base = '/api/v1/submissions';
    // opA now has one SUBMITTED, on-time return against tplId.
    const submitted = await request(server)
      .get(base)
      .query({ status: 'SUBMITTED' })
      .set(auth(opAToken))
      .expect(200);
    expect(submitted.body.data.length).toBeGreaterThan(0);
    expect(submitted.body.data.every((s: { status: string }) => s.status === 'SUBMITTED')).toBe(
      true,
    );

    const onTime = await request(server)
      .get(base)
      .query({ isLate: 'false' })
      .set(auth(opAToken))
      .expect(200);
    expect(onTime.body.data.length).toBeGreaterThan(0);

    const late = await request(server)
      .get(base)
      .query({ isLate: 'true' })
      .set(auth(opAToken))
      .expect(200);
    expect(late.body.data.length).toBe(0);

    const byTemplate = await request(server)
      .get(base)
      .query({ templateId: tplId })
      .set(auth(opAToken))
      .expect(200);
    expect(byTemplate.body.data.length).toBeGreaterThan(0);

    const inRange = await request(server)
      .get(base)
      .query({ submittedFrom: '2000-01-01', submittedTo: '2999-12-31' })
      .set(auth(opAToken))
      .expect(200);
    expect(inRange.body.data.length).toBeGreaterThan(0);

    const outOfRange = await request(server)
      .get(base)
      .query({ submittedFrom: '2999-01-01' })
      .set(auth(opAToken))
      .expect(200);
    expect(outOfRange.body.data.length).toBe(0);
  });

  it('blocks submit when a mandatory field is missing (400)', async () => {
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opBToken))
      .send({ periodId })
      .expect(201);
    await request(server)
      .post(`/api/v1/submissions/${draft.body.id}/submit`)
      .set(auth(opBToken))
      .send({ signedName: 'Someone' })
      .expect(400);
  });

  it('blocks submit when a cross-field rule is violated (400)', async () => {
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opBToken))
      .send({ periodId })
      .expect(201);
    const id = draft.body.id;
    await request(server)
      .put(`/api/v1/submissions/${id}/values`)
      .set(auth(opBToken))
      .send({
        values: [
          { fieldId: nameFieldId, valueText: 'Demo MNO B' },
          { fieldId: subsFieldId, valueText: '1000' },
          { fieldId: activeFieldId, valueText: '1500' }, // active > subs → hard
        ],
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opBToken))
      .send({ signedName: 'B Op' })
      .expect(400);
  });

  it('dry-run validate reports the cross-field issue without submitting', async () => {
    const list = await request(server).get('/api/v1/submissions').set(auth(opBToken)).expect(200);
    const draft = list.body.data.find((s: { status: string }) => s.status === 'DRAFT');
    const res = await request(server)
      .post(`/api/v1/submissions/${draft.id}/validate`)
      .set(auth(opBToken))
      .expect(201);
    expect(res.body.hard.length).toBeGreaterThan(0);
    expect(res.body.hard.some((i: { code: string }) => i.code === 'LESS_OR_EQUAL')).toBe(true);
    // The submission is still a draft — validate never mutates.
    const still = await request(server)
      .get(`/api/v1/submissions/${draft.id}`)
      .set(auth(opBToken))
      .expect(200);
    expect(still.body.status).toBe('DRAFT');
  });

  it('keeps submissions segregated between operators', async () => {
    const aList = await request(server).get('/api/v1/submissions').set(auth(opAToken)).expect(200);
    const aId = aList.body.data[0].id;
    // B cannot read A's submission by id.
    await request(server).get(`/api/v1/submissions/${aId}`).set(auth(opBToken)).expect(403);
    // B's list never contains A's submission.
    const bList = await request(server).get('/api/v1/submissions').set(auth(opBToken)).expect(200);
    expect(bList.body.data.some((s: { id: string }) => s.id === aId)).toBe(false);
  });

  it('stops a suspended entity from starting a return (403)', async () => {
    await request(server)
      .post('/api/v1/submissions')
      .set(auth(opSToken))
      .send({ periodId })
      .expect(403);
  });

  it('offers a suspended entity no startable periods', async () => {
    const res = await request(server)
      .get('/api/v1/submissions/startable-periods')
      .set(auth(opSToken))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('lets an operator start again after deleting a draft, rather than locking the period', async () => {
    // Regression: deletion is soft, so the deleted draft kept its slot in
    // @@unique([entityId, periodId, version]). startablePeriods offered the period again and every
    // attempt to start it collided, locking the operator out of filing for that period for good.
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tplId,
        frequency: 'QUARTERLY',
        label: '2026 Q9 delete-restart',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });

    const first = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opAToken))
      .send({ periodId: period.id })
      .expect(201);
    await request(server)
      .put(`/api/v1/submissions/${first.body.id}/values`)
      .set(auth(opAToken))
      .send({ values: [{ fieldId: nameFieldId, valueText: 'First attempt' }] })
      .expect(200);
    await request(server)
      .delete(`/api/v1/submissions/${first.body.id}`)
      .set(auth(opAToken))
      .expect(200);

    // The period is offered again...
    const startable = await request(server)
      .get('/api/v1/submissions/startable-periods')
      .set(auth(opAToken))
      .expect(200);
    expect(startable.body.some((p: { id: string }) => p.id === period.id)).toBe(true);

    // ...and starting it actually works, giving a clean draft rather than the deleted answers.
    const second = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opAToken))
      .send({ periodId: period.id })
      .expect(201);
    expect(second.body.status).toBe('DRAFT');
    expect(second.body.values).toEqual([]);
  });

  it('refuses to delete a draft once its period has closed', async () => {
    // Deleting is a write, so it takes the same guard as editing: an operator who may no longer
    // edit the draft may not destroy it either.
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tplId,
        frequency: 'QUARTERLY',
        label: '2026 Q9 closed-delete',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opAToken))
      .send({ periodId: period.id })
      .expect(201);

    await prisma.reportingPeriod.update({
      where: { id: period.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    await request(server)
      .delete(`/api/v1/submissions/${draft.body.id}`)
      .set(auth(opAToken))
      .expect(400);
  });

  it('drops a period from startable once a return is begun (submitted or draft)', async () => {
    // A submitted this period; B has a draft for it — neither may start it again.
    const aStartable = await request(server)
      .get('/api/v1/submissions/startable-periods')
      .set(auth(opAToken))
      .expect(200);
    expect(aStartable.body.some((p: { id: string }) => p.id === periodId)).toBe(false);

    const bStartable = await request(server)
      .get('/api/v1/submissions/startable-periods')
      .set(auth(opBToken))
      .expect(200);
    expect(bStartable.body.some((p: { id: string }) => p.id === periodId)).toBe(false);
  });
  describe('answers are stored as data, never as SQL', () => {
    it('keeps an answer containing quotes and a semicolon exactly as typed', async () => {
      // Values are written with a hand-built bulk INSERT ... ON CONFLICT for speed, so this is
      // worth proving rather than assuming: the parameters have to arrive as parameters.
      // Its own period, because by this point in the suite the shared one has been filed.
      const period = await prisma.reportingPeriod.findUnique({
        where: { id: periodId },
        select: { templateId: true },
      });
      const fresh = await prisma.reportingPeriod.create({
        data: {
          templateId: period!.templateId,
          frequency: 'QUARTERLY',
          label: '2026 Q4 injection',
          periodStart: new Date('2026-10-01'),
          periodEnd: new Date('2026-12-31'),
          dueDate: new Date('2999-01-15'),
          status: 'OPEN',
          openedAt: new Date(),
        },
      });

      const draft = await request(server)
        .post('/api/v1/submissions')
        .set(auth(opAToken))
        .send({ periodId: fresh.id })
        .expect(201);

      const nasty = `O'Brien"; DROP TABLE submission_values; --`;
      await request(server)
        .put(`/api/v1/submissions/${draft.body.id}/values`)
        .set(auth(opAToken))
        .send({ values: [{ fieldId: nameFieldId, valueText: nasty }] })
        .expect(200);

      const stored = await prisma.submissionValue.findFirst({
        where: { submissionId: draft.body.id, fieldId: nameFieldId },
        select: { valueText: true },
      });
      expect(stored!.valueText).toBe(nasty);

      // And the table is still there, which is the other half of the point.
      expect(await prisma.submissionValue.count()).toBeGreaterThan(0);
    });
  });
});
