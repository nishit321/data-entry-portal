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

const FILING = {
  category: 'SERVICE_QUALITY',
  subject: 'No signal for a week',
  description: 'There has been no coverage in my area since last Monday and calls do not connect.',
  complainantName: 'A Citizen',
  complainantEmail: 'citizen@example.test',
};

/** Citizen complaint intake over real HTTP: public filing, guarded tracking, Authority handling. */
describe('Complaints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-cmp-admin@nca.test';
  const opEmail = 'e2e-cmp-op@x.test';
  const emails = [adminEmail, opEmail];
  const licence = 'E2E/CMP';

  let adminToken: string;
  let opToken: string;
  let entityId: string;
  const filedReferences: string[] = [];

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
    await prisma.complaint.deleteMany({
      where: {
        OR: [
          { referenceNumber: { in: filedReferences } },
          { aboutEntity: { licenceNumber: licence } },
        ],
      },
    });
    await prisma.notification.deleteMany({ where: { recipient: { email: { in: emails } } } });
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
    const entity = await prisma.entity.create({
      data: {
        name: 'Complaint Target',
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

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** File a complaint as an anonymous member of the public (no Authorization header). */
  async function fileComplaint(body: Record<string, unknown> = {}) {
    const res = await request(server)
      .post('/api/v1/complaints')
      .send({ ...FILING, ...body })
      .expect(201);
    filedReferences.push(res.body.referenceNumber);
    return res.body as { referenceNumber: string; trackingCode: string };
  }

  it('lets the public file without signing in, and issues a reference and tracking code', async () => {
    const filed = await fileComplaint({ aboutEntityId: entityId });
    expect(filed.referenceNumber).toMatch(/^NCA\/CMP\/\d{4}\/\d{6}$/);
    expect(filed.trackingCode).toEqual(expect.any(String));
  });

  it('validates the filing rather than accepting anything', async () => {
    await request(server)
      .post('/api/v1/complaints')
      .send({ ...FILING, description: 'too short' })
      .expect(400);
    await request(server)
      .post('/api/v1/complaints')
      .send({ ...FILING, complainantEmail: 'not-an-email' })
      .expect(400);
    await request(server)
      .post('/api/v1/complaints')
      .send({ ...FILING, category: 'NONSENSE' })
      .expect(400);
  });

  it('tracks a complaint with the reference and code, exposing no personal details', async () => {
    const filed = await fileComplaint();
    const res = await request(server)
      .post('/api/v1/complaints/track')
      .send({ referenceNumber: filed.referenceNumber, trackingCode: filed.trackingCode })
      .expect(201);

    expect(res.body.status).toBe('RECEIVED');
    expect(res.body.subject).toBe(FILING.subject);
    // The public view must not echo the filer's details, the description, or any internal handling.
    expect(res.body.complainantName).toBeUndefined();
    expect(res.body.complainantEmail).toBeUndefined();
    expect(res.body.description).toBeUndefined();
    expect(res.body.handledBy).toBeUndefined();
    expect(res.body.trackingCodeHash).toBeUndefined();
  });

  it('refuses to open a complaint from the reference number alone', async () => {
    const filed = await fileComplaint();
    // A reference is sequential and shareable, so on its own it must unlock nothing.
    await request(server)
      .post('/api/v1/complaints/track')
      .send({ referenceNumber: filed.referenceNumber, trackingCode: 'guessed-code' })
      .expect(404);
  });

  it('keeps the case list away from operators and the public', async () => {
    await request(server).get('/api/v1/complaints').expect(401);
    await request(server).get('/api/v1/complaints').set(auth(opToken)).expect(403);
  });

  it('shows the Authority the full case and notifies it of the filing', async () => {
    const list = await request(server).get('/api/v1/complaints').set(auth(adminToken)).expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);

    const row = list.body.data[0];
    // The Authority does see the description and contact details: that is the case file.
    expect(row.description).toBeDefined();
    expect(row).toHaveProperty('complainantEmail');

    const feed = (
      await request(server).get('/api/v1/notifications').set(auth(adminToken)).expect(200)
    ).body;
    expect(feed.data.some((n: { type: string }) => n.type === 'COMPLAINT_RECEIVED')).toBe(true);
  });

  it('moves a case through review to resolved, and the citizen sees the new status', async () => {
    const filed = await fileComplaint();
    const list = await request(server)
      .get('/api/v1/complaints')
      .query({ search: filed.referenceNumber })
      .set(auth(adminToken))
      .expect(200);
    const id = list.body.data[0].id;

    await request(server)
      .patch(`/api/v1/complaints/${id}/status`)
      .set(auth(adminToken))
      .send({ status: 'IN_REVIEW' })
      .expect(200);

    const resolved = await request(server)
      .patch(`/api/v1/complaints/${id}/status`)
      .set(auth(adminToken))
      .send({ status: 'RESOLVED', resolutionNote: 'The mast has been repaired.' })
      .expect(200);
    expect(resolved.body.resolvedAt).not.toBeNull();

    // The citizen tracking their reference now sees the outcome.
    const tracked = await request(server)
      .post('/api/v1/complaints/track')
      .send({ referenceNumber: filed.referenceNumber, trackingCode: filed.trackingCode })
      .expect(201);
    expect(tracked.body.status).toBe('RESOLVED');
    expect(tracked.body.resolutionNote).toBe('The mast has been repaired.');
  });

  it('does not let an operator change a complaint status', async () => {
    const list = await request(server).get('/api/v1/complaints').set(auth(adminToken)).expect(200);
    await request(server)
      .patch(`/api/v1/complaints/${list.body.data[0].id}/status`)
      .set(auth(opToken))
      .send({ status: 'CLOSED' })
      .expect(403);
  });
});
