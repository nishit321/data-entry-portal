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
});
