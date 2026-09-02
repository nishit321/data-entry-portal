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

const PDF = Buffer.from('%PDF-1.7\n%licence scan\n1 0 obj');
const CSV = Buffer.from('not,a,document\n');

/** The licence repository over real HTTP: versioning, scoping, and expiry alerts. */
describe('Documents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-doc-admin@nca.test';
  const opAEmail = 'e2e-doc-a@x.test';
  const opBEmail = 'e2e-doc-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/DOCA', 'E2E/DOCB'];

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let entityAId: string;

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
    await prisma.documentRecord.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
    await prisma.notification.deleteMany({ where: { recipient: { email: { in: emails } } } });
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
        name: 'Doc Alpha',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Doc Bravo',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    entityAId = entA.id;
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

    adminToken = await login(adminEmail);
    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const upload = (
    token: string,
    fields: Record<string, string>,
    file = PDF,
    name = 'licence.pdf',
  ) => {
    const req = request(server).post('/api/v1/documents').set(auth(token));
    Object.entries(fields).forEach(([k, v]) => void req.field(k, v));
    return req.attach('file', file, name);
  };

  const list = async (token: string, query: Record<string, string> = {}) =>
    (await request(server).get('/api/v1/documents').query(query).set(auth(token)).expect(200)).body;

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/documents').expect(401);
  });

  it('files a licence and lists it back with its expiry state', async () => {
    // Expires in 30 days, so it lands inside the default 60-day warning window.
    const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const created = await upload(opAToken, {
      kind: 'LICENCE',
      title: 'Operating licence',
      reference: 'NCA/LIC/001',
      expiresAt,
    }).expect(201);

    expect(created.body.title).toBe('Operating licence');
    expect(created.body.version).toBe(1);
    // The internal storage key must never reach the client.
    expect(created.body.storageKey).toBeUndefined();
    expect(created.body.expiry.stage).toBe('EXPIRING');

    const feed = await list(opAToken);
    expect(feed.data.some((d: { id: string }) => d.id === created.body.id)).toBe(true);
  });

  it('rejects a file that is not a document', async () => {
    await upload(opBToken, { kind: 'OTHER', title: 'Wrong format' }, CSV, 'data.csv').expect(400);
  });

  it('rejects an expiry date that is not after the issue date', async () => {
    await upload(opBToken, {
      kind: 'LICENCE',
      title: 'Bad dates',
      issuedAt: '2026-06-01',
      expiresAt: '2026-01-01',
    }).expect(400);
  });

  it('versions a replacement and shows only the current one', async () => {
    const first = await upload(opBToken, { kind: 'CERTIFICATE', title: 'Type approval' }).expect(
      201,
    );

    const replacement = await upload(opBToken, {
      kind: 'CERTIFICATE',
      title: 'Type approval (renewed)',
      supersedesId: first.body.id,
    }).expect(201);
    expect(replacement.body.version).toBe(2);
    expect(replacement.body.supersedesId).toBe(first.body.id);

    // The list shows the current version only; the superseded one is retained as history.
    const feed = await list(opBToken);
    const ids = feed.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(replacement.body.id);
    expect(ids).not.toContain(first.body.id);

    // A document can only be replaced once.
    await upload(opBToken, {
      kind: 'CERTIFICATE',
      title: 'Second replacement',
      supersedesId: first.body.id,
    }).expect(400);
  });

  it('downloads the stored file', async () => {
    const feed = await list(opAToken);
    const id = feed.data[0].id;
    const res = await request(server)
      .get(`/api/v1/documents/${id}/download`)
      .set(auth(opAToken))
      .responseType('blob')
      .expect(200);
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  it('keeps one operator repository out of another', async () => {
    const aFeed = await list(opAToken);
    const aId = aFeed.data[0].id;

    await request(server).get(`/api/v1/documents/${aId}/download`).set(auth(opBToken)).expect(403);

    const bFeed = await list(opBToken);
    expect(bFeed.data.every((d: { entityId: string }) => d.entityId !== entityAId)).toBe(true);

    // The Authority sees both repositories.
    const all = await list(adminToken);
    expect(all.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('alerts the operator when a document is nearing expiry, and only once', async () => {
    // The sweep is global, so assert on this operator's own alerts rather than the overall count:
    // a parallel suite's documents must not be able to make or break this test.
    const expiryAlerts = async () => {
      const feed = (
        await request(server).get('/api/v1/notifications').set(auth(opAToken)).expect(200)
      ).body;
      return feed.data.filter((n: { type: string }) => n.type === 'DOCUMENT_EXPIRING').length;
    };

    const sweep = () =>
      request(server).post('/api/v1/documents/sweep-expiries').set(auth(adminToken)).expect(201);

    // The sweep can also be triggered from the scheduler suite, so this does not assume the alert
    // has not already been sent. What matters is that exactly one is sent for this document.
    await sweep();
    expect(await expiryAlerts()).toBe(1);

    // Re-running the sweep sends nothing new — the stage has already been alerted.
    await sweep();
    expect(await expiryAlerts()).toBe(1);
  });

  it('lets an operator remove a document, and hides it afterwards', async () => {
    const feed = await list(opAToken);
    const id = feed.data[0].id;
    await request(server).delete(`/api/v1/documents/${id}`).set(auth(opAToken)).expect(200);

    const after = await list(opAToken);
    expect(after.data.some((d: { id: string }) => d.id === id)).toBe(false);
  });
});
