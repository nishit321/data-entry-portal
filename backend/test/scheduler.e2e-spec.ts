import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** The background jobs: visible to the Authority, runnable by hand, and off during tests. */
describe('Scheduler (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-sch-admin@nca.test';
  const supervisorEmail = 'e2e-sch-sup@nca.test';
  const opEmail = 'e2e-sch-op@x.test';
  const emails = [adminEmail, supervisorEmail, opEmail];
  const licence = 'E2E/SCH';

  let adminToken: string;
  let supervisorToken: string;
  let opToken: string;

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
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NCA',
        role: Role.ADMIN,
      },
    });
    await prisma.user.create({
      data: {
        email: supervisorEmail,
        passwordHash,
        firstName: 'Sup',
        lastName: 'NCA',
        role: Role.SUPERVISOR,
      },
    });
    const entity = await prisma.entity.create({
      data: {
        name: 'Sched Op',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
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

    adminToken = await login(adminEmail);
    supervisorToken = await login(supervisorEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/scheduler/status').expect(401);
  });

  it('reports every job and its schedule', async () => {
    const res = await request(server)
      .get('/api/v1/scheduler/status')
      .set(auth(adminToken))
      .expect(200);

    // Registration is deliberately off under NODE_ENV=test, so a sweep never fires mid-suite.
    expect(res.body.enabled).toBe(false);
    expect(res.body.jobs.map((j: { name: string }) => j.name)).toEqual([
      'compliance-sweep',
      'document-expiry',
      'notification-retry',
      'penalty-accrual',
      'scheduled-reports',
      'nonce-sweep',
      'network-feeds',
    ]);
    expect(res.body.jobs[0].cron).toEqual(expect.any(String));
  });

  it('lets a supervisor read the status but not run a job', async () => {
    await request(server).get('/api/v1/scheduler/status').set(auth(supervisorToken)).expect(200);
    await request(server)
      .post('/api/v1/scheduler/jobs/document-expiry/run')
      .set(auth(supervisorToken))
      .expect(403);
  });

  it('keeps the scheduler away from operators', async () => {
    await request(server).get('/api/v1/scheduler/status').set(auth(opToken)).expect(403);
    await request(server)
      .post('/api/v1/scheduler/jobs/document-expiry/run')
      .set(auth(opToken))
      .expect(403);
  });

  it('runs a job by hand and reports what it did', async () => {
    const res = await request(server)
      .post('/api/v1/scheduler/jobs/document-expiry/run')
      .set(auth(adminToken))
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('document-expiry');
    expect(res.body.summary).toMatch(/document/i);

    // The run is then visible in the status, so nobody has to read the logs to confirm it.
    const status = await request(server)
      .get('/api/v1/scheduler/status')
      .set(auth(adminToken))
      .expect(200);
    const job = status.body.jobs.find((j: { name: string }) => j.name === 'document-expiry');
    expect(job.lastRun.ok).toBe(true);
  });

  it('rejects a job name that does not exist', async () => {
    await request(server)
      .post('/api/v1/scheduler/jobs/not-a-job/run')
      .set(auth(adminToken))
      .expect(400);
  });
});
