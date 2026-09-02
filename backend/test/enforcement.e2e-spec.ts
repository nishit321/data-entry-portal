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

/** The deadline / enforcement engine over real HTTP: closing a period flags the non-filers (Q3). */
describe('Enforcement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-enf-admin@nca.test';
  const opAEmail = 'e2e-enf-a@x.test';
  const opBEmail = 'e2e-enf-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/ENFA', 'E2E/ENFB'];
  const tplName = 'E2E Enforcement Template';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let entityBId: string;
  let periodId: string;
  let nameFieldId: string;

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
    await prisma.notification.deleteMany({ where: { recipient: { email: { in: emails } } } });
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
        name: 'Enf A (files)',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Enf B (misses)',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    entityBId = entB.id;
    await prisma.user.create({
      data: {
        email: opAEmail,
        passwordHash,
        firstName: 'A',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    await prisma.user.create({
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
              key: 'general',
              title: 'General',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'QUARTERLY_AND_ANNUAL',
              fields: {
                create: [
                  { key: 'op_name', label: 'Name', order: 1, dataType: 'TEXT', isMandatory: true },
                ],
              },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    nameFieldId = tpl.sections[0].fields.find((f) => f.key === 'op_name')!.id;

    // Open, and not yet due. The deadline is moved into the past further down, once A has filed.
    //
    // It matters that the period is not overdue while it sits here empty: the compliance sweep is
    // global and any other suite can set it running, which would open a case against A for a
    // deadline it has not missed yet and make this suite fail for reasons of its own.
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2020 Q1',
        periodStart: new Date('2020-01-01'),
        periodEnd: new Date('2020-03-31'),
        dueDate: new Date('2999-04-15'),
        graceDays: 5,
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    periodId = period.id;

    adminToken = await login(adminEmail);
    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /**
   * Cases for this suite's own period. Every suite that leaves an overdue period behind causes the
   * global sweep to open cases against every active MNO, this suite's entities included, so an
   * unfiltered read says nothing about what this suite's own sweep did.
   */
  const cases = async (token: string) =>
    (
      await request(server)
        .get('/api/v1/enforcement')
        .query({ periodId })
        .set(auth(token))
        .expect(200)
    ).body;

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/enforcement').expect(401);
  });

  it('opens a case for a non-filer when the period is closed, but not for a filer', async () => {
    // Entity A files; entity B does not.
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opAToken))
      .send({ periodId })
      .expect(201);
    await request(server)
      .put(`/api/v1/submissions/${draft.body.id}/values`)
      .set(auth(opAToken))
      .send({ values: [{ fieldId: nameFieldId, valueText: 'Filed on record' }] })
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${draft.body.id}/submit`)
      .set(auth(opAToken))
      .send({ signedName: 'A Op' })
      .expect(201);

    // The deadline passes. A has filed; B has not.
    await prisma.reportingPeriod.update({
      where: { id: periodId },
      data: { dueDate: new Date('2020-04-15') },
    });

    // Admin closes the period → compliance sweep opens a case for the non-filer (B) only.
    await request(server)
      .post(`/api/v1/reporting-periods/${periodId}/close`)
      .set(auth(adminToken))
      .expect(201);

    const all = await cases(adminToken);
    const forB = all.data.filter((c: { entity: { id: string } }) => c.entity.id === entityBId);
    expect(forB.length).toBe(1);
    expect(forB[0].status).toBe('OPEN');
    expect(forB[0].reason).toBe('MISSED_DEADLINE');
    // No case for the entity that filed.
    expect(
      all.data.some((c: { entity: { name: string } }) => c.entity.name === 'Enf A (files)'),
    ).toBe(false);
  });

  it('notifies the non-filing operator that a case opened', async () => {
    const feed = (
      await request(server).get('/api/v1/notifications').set(auth(opBToken)).expect(200)
    ).body;
    expect(feed.data.some((n: { type: string }) => n.type === 'ENFORCEMENT_CASE_OPENED')).toBe(
      true,
    );
  });

  it('scopes cases: an operator sees only their own', async () => {
    const bView = await cases(opBToken);
    expect(bView.data.length).toBeGreaterThanOrEqual(1);
    expect(bView.data.every((c: { entity: { id: string } }) => c.entity.id === entityBId)).toBe(
      true,
    );

    const aView = await cases(opAToken);
    expect(aView.data.every((c: { entity: { id: string } }) => c.entity.id !== entityBId)).toBe(
      true,
    );
  });

  it('lets an operator neither sweep nor resolve (403)', async () => {
    await request(server).post('/api/v1/enforcement/sweep').set(auth(opBToken)).expect(403);
    const caseId = (await cases(adminToken)).data[0].id;
    await request(server)
      .patch(`/api/v1/enforcement/${caseId}/resolve`)
      .set(auth(opBToken))
      .send({})
      .expect(403);
  });

  it('resolves a case and refuses to resolve it twice', async () => {
    const caseId = (await cases(adminToken)).data.find(
      (c: { entity: { id: string } }) => c.entity.id === entityBId,
    ).id;

    const resolved = await request(server)
      .patch(`/api/v1/enforcement/${caseId}/resolve`)
      .set(auth(adminToken))
      .send({ note: 'Operator has since filed the return' })
      .expect(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedBy).not.toBeNull();

    await request(server)
      .patch(`/api/v1/enforcement/${caseId}/waive`)
      .set(auth(adminToken))
      .send({})
      .expect(400);
  });

  it('notifies the operator when their case is resolved', async () => {
    const feed = (
      await request(server).get('/api/v1/notifications').set(auth(opBToken)).expect(200)
    ).body;
    expect(feed.data.some((n: { type: string }) => n.type === 'ENFORCEMENT_CASE_CLOSED')).toBe(
      true,
    );
  });

  it('sweep is idempotent: re-running opens no duplicate cases for our entity', async () => {
    // Scope the count to entity B *on this suite's period*. Entity B is an active MNO, so a
    // parallel suite that leaves an overdue period behind will legitimately have a case opened
    // against it — the pair (our entity, our period) is the only part this suite owns.
    const bCount = async () =>
      (
        await request(server)
          .get('/api/v1/enforcement')
          .query({ entityId: entityBId, periodId })
          .set(auth(adminToken))
          .expect(200)
      ).body.meta.total;

    const before = await bCount();
    const summary = await request(server)
      .post('/api/v1/enforcement/sweep')
      .set(auth(adminToken))
      .expect(201);
    expect(summary.body).toHaveProperty('casesOpened');
    expect(await bCount()).toBe(before);
  });
});
