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

/** Reporting-period lifecycle over real HTTP: RBAC, published-template guard, open/close. */
describe('Reporting periods (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-rp-admin@nca.test';
  const opEmail = 'e2e-rp-op@x.test';
  const licence = 'E2E/RP';
  const pubName = 'E2E RP Published';
  const draftName = 'E2E RP Draft';

  let adminToken: string;
  let opToken: string;
  let entityId: string;
  let publishedId: string;
  let draftId: string;

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
    // Returns hold FKs to the period, template, and entity, so they go first.
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: licence } } });
    await prisma.reportingPeriod.deleteMany({
      where: { template: { name: { in: [pubName, draftName] } } },
    });
    await prisma.reportingTemplate.deleteMany({ where: { name: { in: [pubName, draftName] } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, opEmail] } } });
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
        name: 'RP Op',
        type: EntityType.MMO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'RP',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'RP',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    const published = await prisma.reportingTemplate.create({
      data: {
        name: pubName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    const draft = await prisma.reportingTemplate.create({
      data: { name: draftName, version: 1, status: TemplateStatus.DRAFT },
    });
    publishedId = published.id;
    draftId = draft.id;

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
    entityId = entity.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const body = (templateId: string) => ({
    templateId,
    frequency: 'QUARTERLY',
    label: '2026 Q1',
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    dueDate: '2026-04-15',
  });

  /** One period against the published template, labelled uniquely so a re-run cannot collide. */
  const create = (over: { label: string; usdRate?: number }) =>
    request(server)
      .post('/api/v1/reporting-periods')
      .set(auth(adminToken))
      .send({ ...body(publishedId), ...over, label: `${over.label} ${Date.now()}` });

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/reporting-periods').expect(401);
  });

  it('forbids an operator from opening a period (403)', async () => {
    await request(server)
      .post('/api/v1/reporting-periods')
      .set(auth(opToken))
      .send(body(publishedId))
      .expect(403);
  });

  it('rejects a period against a draft template (400)', async () => {
    await request(server)
      .post('/api/v1/reporting-periods')
      .set(auth(adminToken))
      .send(body(draftId))
      .expect(400);
  });

  it('opens, closes, and lists a period on a published template', async () => {
    const created = await request(server)
      .post('/api/v1/reporting-periods')
      .set(auth(adminToken))
      .send(body(publishedId))
      .expect(201);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.timeline?.phase).toBeDefined();
    expect(created.body.timeline?.graceEndsAt).toBeDefined();
    const id = created.body.id;

    const closed = await request(server)
      .post(`/api/v1/reporting-periods/${id}/close`)
      .set(auth(adminToken))
      .expect(201);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.timeline.phase).toBe('closed');

    // Operators can read periods (they need to see open ones to submit).
    const list = await request(server)
      .get('/api/v1/reporting-periods?templateId=' + publishedId)
      .set(auth(opToken))
      .expect(200);
    expect(list.body.data.some((p: { id: string }) => p.id === id)).toBe(true);
  });

  it('refuses to delete a period that returns have been filed against', async () => {
    // Deleting it would strand those returns: the editable-draft guard reads period.status, so an
    // operator could carry on editing and submitting into a period the Authority believes is gone.
    const created = await request(server)
      .post('/api/v1/reporting-periods')
      .set(auth(adminToken))
      .send({ ...body(publishedId), label: '2026 Q2 with a return' })
      .expect(201);
    const periodId = created.body.id;

    const template = await prisma.reportingTemplate.findFirst({
      where: { id: publishedId },
      select: { id: true },
    });
    const opUser = await prisma.user.findFirst({
      where: { email: opEmail },
      select: { id: true },
    });
    await prisma.submission.create({
      data: {
        entityId,
        periodId,
        templateId: template!.id,
        createdById: opUser!.id,
      },
    });

    await request(server)
      .delete(`/api/v1/reporting-periods/${periodId}`)
      .set(auth(adminToken))
      .expect(400);

    // With nothing filed against it, a period still deletes normally.
    const spare = await request(server)
      .post('/api/v1/reporting-periods')
      .set(auth(adminToken))
      .send({ ...body(publishedId), label: '2026 Q3 unused' })
      .expect(201);
    await request(server)
      .delete(`/api/v1/reporting-periods/${spare.body.id}`)
      .set(auth(adminToken))
      .expect(200);
  });

  describe('the USD rate (NCA, 3 September 2026)', () => {
    /*
     * NCA asked for the rate to be stored per reporting period with a date, and gave the reason:
     * "so updating today's rate doesn't silently rewrite last year's audited USD figures".
     *
     * That reason is the specification, and it is what these check — not that a column exists.
     */
    it('starts at the rate NCA gave, when there is nothing to carry forward', async () => {
      // Every other period in the database is this suite's own, and the first one made here has
      // no predecessor with a rate.
      const first = await create({ label: 'USD first' });
      expect(first.status).toBe(201);
      expect(Number(first.body.usdRate)).toBe(7000);
      expect(first.body.usdRateAt).toBeTruthy();
    });

    it('carries the last rate forward, so nobody retypes a number that has not moved', async () => {
      await create({ label: 'USD carry a', usdRate: 7250 });
      const next = await create({ label: 'USD carry b' });
      expect(next.status).toBe(201);
      expect(Number(next.body.usdRate)).toBe(7250);
    });

    it('leaves an earlier period untouched when a later one is corrected', async () => {
      /*
       * The whole point, stated as a test. A single current rate would fail this: correcting the
       * figure for one quarter would restate every USD column in the system, including years that
       * have been audited and relied on.
       */
      const earlier = await create({ label: 'USD 2026', usdRate: 7000 });
      const later = await create({ label: 'USD 2027', usdRate: 7000 });

      const corrected = await request(server)
        .patch(`/api/v1/reporting-periods/${later.body.id}`)
        .set(auth(adminToken))
        .send({ usdRate: 9500 });
      expect(corrected.status).toBe(200);
      expect(Number(corrected.body.usdRate)).toBe(9500);

      const unchanged = await request(server)
        .get(`/api/v1/reporting-periods/${earlier.body.id}`)
        .set(auth(adminToken));
      expect(Number(unchanged.body.usdRate)).toBe(7000);
    });

    it('records when the rate was set, not only what it is', async () => {
      // "with a date" was part of the instruction. A rate with no date is a figure nobody can
      // place against an audit.
      const before = new Date();
      const created = await create({ label: 'USD dated', usdRate: 7100 });
      const setAt = new Date(created.body.usdRateAt as string);
      expect(setAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 2000);
    });

    it.each([
      ['zero', 0],
      ['negative', -100],
    ])('refuses a %s rate', async (_name, usdRate) => {
      // A rate of zero would make every USD figure zero rather than obviously wrong.
      const res = await create({ label: `USD bad ${usdRate}`, usdRate });
      expect(res.status).toBe(400);
    });

    it('changes nothing for an operator filing a return', async () => {
      // The rate is the Authority's setting. An operator must not be able to move it, because
      // moving it moves what every figure in the period is worth.
      const period = await create({ label: 'USD guarded', usdRate: 7000 });
      const res = await request(server)
        .patch(`/api/v1/reporting-periods/${period.body.id}`)
        .set(auth(opToken))
        .send({ usdRate: 1 });
      expect(res.status).toBe(403);
    });
  });
});
