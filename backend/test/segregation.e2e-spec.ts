import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);

/** The static demo OTP (config OTP_STATIC_CODE default). */
const OTP = '123456';

/**
 * End-to-end proof, over the real HTTP pipeline (guards → versioning →
 * validation → services), that RBAC and data segregation hold. Two operators in
 * two different entities must never see each other's data, and role limits must
 * be enforced by the server regardless of what the client sends.
 */
describe('RBAC & data segregation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const emails = ['e2e-admin@nca.test', 'e2e-opa@x.test', 'e2e-opb@x.test'];
  const licences = ['E2E/A', 'E2E/B'];

  let entAId: string;
  let entBId: string;
  let agentBId: string;

  let adminToken: string;
  let opAToken: string;

  // Two-step login: password → OTP challenge → verify (MFA is on by default).
  async function login(email: string, password: string): Promise<string> {
    const res = await request(server).post('/api/v1/auth/login').send({ email, password });
    if (res.body.accessToken) return res.body.accessToken as string; // MFA off
    expect(res.body.mfaRequired).toBe(true);
    const verified = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    expect(verified.body.accessToken).toBeDefined();
    return verified.body.accessToken as string;
  }

  async function cleanup() {
    await prisma.agent.deleteMany({ where: { agentReference: { in: ['A-1', 'B-1'] } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: licences } } });
  }

  beforeAll(async () => {
    // Rate limiting is disabled under NODE_ENV=test (ThrottlerModule skipIf), so
    // multi-attempt cases (lockout) aren't throttled first.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app); // identical pipeline to production
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup(); // clear any leftovers from a prior run

    const passwordHash = await hashPassword(PASSWORD);
    const entA = await prisma.entity.create({
      data: {
        name: 'E2E Alpha',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: 'E2E/A',
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'E2E Beta',
        type: EntityType.ISP,
        status: EntityStatus.ACTIVE,
        licenceNumber: 'E2E/B',
      },
    });
    entAId = entA.id;
    entBId = entB.id;

    await prisma.user.create({
      data: {
        email: emails[0],
        passwordHash,
        firstName: 'E2E',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    await prisma.user.create({
      data: {
        email: emails[1],
        passwordHash,
        firstName: 'Op',
        lastName: 'A',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    await prisma.user.create({
      data: {
        email: emails[2],
        passwordHash,
        firstName: 'Op',
        lastName: 'B',
        role: Role.OPERATOR_ADMIN,
        entityId: entB.id,
      },
    });

    await prisma.agent.create({
      data: { entityId: entA.id, agentReference: 'A-1', name: 'Agent A1' },
    });
    const agentB = await prisma.agent.create({
      data: { entityId: entB.id, agentReference: 'B-1', name: 'Agent B1' },
    });
    agentBId = agentB.id;

    adminToken = await login(emails[0], PASSWORD);
    opAToken = await login(emails[1], PASSWORD);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('rejects unauthenticated access (401)', async () => {
    await request(server).get('/api/v1/agents').expect(401);
  });

  it('enforces URI versioning: the unversioned path is 404', async () => {
    await request(server)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('an operator sees only its own entity agents', async () => {
    const res = await request(server)
      .get('/api/v1/agents')
      .set('Authorization', `Bearer ${opAToken}`)
      .expect(200);
    const rows: Array<{ id: string; entityId: string }> = res.body.data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.entityId === entAId)).toBe(true);
    expect(rows.some((a) => a.id === agentBId)).toBe(false);
  });

  it('ignores a spoofed ?entityId and stays scoped to the operator', async () => {
    const res = await request(server)
      .get(`/api/v1/agents?entityId=${entBId}`)
      .set('Authorization', `Bearer ${opAToken}`)
      .expect(200);
    const rows: Array<{ entityId: string }> = res.body.data;
    expect(rows.every((a) => a.entityId === entAId)).toBe(true);
  });

  it('forbids an operator reading another entity agent by id (403)', async () => {
    await request(server)
      .get(`/api/v1/agents/${agentBId}`)
      .set('Authorization', `Bearer ${opAToken}`)
      .expect(403);
  });

  it('forbids an operator from onboarding an entity (403)', async () => {
    await request(server)
      .post('/api/v1/entities')
      .set('Authorization', `Bearer ${opAToken}`)
      .send({ name: 'Hacked', type: 'ISP', licenceNumber: 'X' })
      .expect(403);
  });

  it('lets an Authority admin see all entities', async () => {
    const res = await request(server)
      .get('/api/v1/entities?pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const licenceNumbers: string[] = res.body.data.map(
      (e: { licenceNumber: string }) => e.licenceNumber,
    );
    expect(licenceNumbers).toEqual(expect.arrayContaining(['E2E/A', 'E2E/B']));
  });

  it('returns the standard error envelope with a requestId', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'nope@x.test', password: 'wrong' })
      .expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, error: expect.any(String) });
    expect(res.body.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });

  describe('MFA & account lockout', () => {
    it('login issues an OTP challenge instead of a token', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: emails[0], password: PASSWORD })
        .expect(200);
      expect(res.body.mfaRequired).toBe(true);
      expect(res.body.challengeId).toBeDefined();
      expect(res.body.accessToken).toBeUndefined();
    });

    it('rejects a wrong OTP, then accepts the correct one', async () => {
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: emails[0], password: PASSWORD })
        .expect(200);
      const challengeId = login.body.challengeId;

      await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId, code: '000000' })
        .expect(401);

      const ok = await request(server)
        .post('/api/v1/auth/verify-otp')
        .send({ challengeId, code: OTP })
        .expect(200);
      expect(ok.body.accessToken).toBeDefined();
    });

    it('locks the account after repeated wrong passwords (423)', async () => {
      // opB is not used for a token elsewhere; safe to lock. Default threshold 5.
      for (let i = 0; i < 4; i++) {
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: emails[2], password: 'wrong-pass' })
          .expect(401);
      }
      // The attempt that crosses the threshold locks the account.
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: emails[2], password: 'wrong-pass' })
        .expect(423);
      // Even the correct password is now rejected while locked.
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: emails[2], password: PASSWORD })
        .expect(423);
    });
  });
});
