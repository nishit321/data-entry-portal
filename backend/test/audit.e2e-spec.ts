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

/** Audit log read endpoint over real HTTP: Authority can list, operators are refused. */
describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-audit-admin@nca.test';
  const opEmail = 'e2e-audit-op@x.test';
  const licence = 'E2E/AUDIT';

  let adminToken: string;
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
        name: 'Audit Op',
        type: EntityType.MMO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Audit',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Audit',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/audit').expect(401);
  });

  it('forbids an operator from reading the audit log (403)', async () => {
    await request(server).get('/api/v1/audit').set(auth(opToken)).expect(403);
  });

  it('lets an Authority role list audit records with the standard envelope', async () => {
    const res = await request(server).get('/api/v1/audit').set(auth(adminToken)).expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.total).toBe('number');
  });

  it('accepts the documented filters', async () => {
    await request(server)
      .get('/api/v1/audit?action=USER_LOGIN&from=2020-01-01&to=2030-12-31&sort=action&order=asc')
      .set(auth(adminToken))
      .expect(200);
  });
});
