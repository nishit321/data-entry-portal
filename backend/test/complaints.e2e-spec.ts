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
  const supervisorEmail = 'e2e-cmp-sup@nca.test';
  const opEmail = 'e2e-cmp-op@x.test';
  const emails = [adminEmail, supervisorEmail, opEmail];
  const licence = 'E2E/CMP';

  let adminToken: string;
  let supervisorToken: string;
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
    supervisorToken = await login(supervisorEmail);
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

  describe('evidence attached to a complaint (NCA, 15 September 2026)', () => {
    /*
     * "Public Complaints: Incorporate an attachment upload option."
     *
     * This is the portal's only write that puts a file on the Authority's disk for a caller who
     * has not signed in, so most of what is worth testing here is not the upload succeeding. It is
     * the shape of the hole: what the credential gets you, what it does not get you, and what a
     * browser is told about a file a stranger sent in.
     */
    const PNG = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('nca complaint evidence fixture'),
    ]);

    const attach = (
      filed: { referenceNumber: string; trackingCode: string },
      name = 'mast.png',
      body: Buffer = PNG,
    ) =>
      request(server)
        .post('/api/v1/complaints/attachments')
        .field('referenceNumber', filed.referenceNumber)
        .field('trackingCode', filed.trackingCode)
        .attach('file', body, name);

    /** The internal id, which the public side never learns. */
    async function caseIdFor(referenceNumber: string): Promise<string> {
      const row = await prisma.complaint.findUniqueOrThrow({
        where: { referenceNumber },
        select: { id: true },
      });
      return row.id;
    }

    it('lets the citizen who filed attach a photograph, and tells them it arrived', async () => {
      const filed = await fileComplaint();
      const uploaded = await attach(filed).expect(201);
      expect(uploaded.body.fileName).toBe('mast.png');
      expect(uploaded.body.sizeBytes).toBe(PNG.length);
      // The key stays internal: it is the one field that would let a caller address the blob.
      expect(uploaded.body.storageKey).toBeUndefined();

      const tracked = await request(server)
        .post('/api/v1/complaints/track')
        .send({ referenceNumber: filed.referenceNumber, trackingCode: filed.trackingCode })
        .expect(201);
      // A count, and nothing that could be turned into a way to fetch the file back.
      expect(tracked.body.attachmentCount).toBe(1);
      expect(JSON.stringify(tracked.body)).not.toContain('mast.png');
    });

    it('refuses a file from anyone who does not hold the tracking code', async () => {
      const filed = await fileComplaint();
      await attach({ referenceNumber: filed.referenceNumber, trackingCode: 'guessed' }).expect(404);

      // Nothing was written, so the count the citizen sees is still zero.
      const tracked = await request(server)
        .post('/api/v1/complaints/track')
        .send({ referenceNumber: filed.referenceNumber, trackingCode: filed.trackingCode })
        .expect(201);
      expect(tracked.body.attachmentCount).toBe(0);
    });

    it('gives the public no way to read a complaint file back', async () => {
      /*
       * The point of the design, and the reason there is no public download route at all. A file
       * that arrives over an unauthenticated route and can be fetched over one is a file host, and
       * everything else on this case would be reachable by whoever found the URL.
       */
      const filed = await fileComplaint();
      const uploaded = await attach(filed).expect(201);
      const id = await caseIdFor(filed.referenceNumber);
      const path = `/api/v1/complaints/${id}/attachments/${uploaded.body.id as string}/download`;

      await request(server).get(`/api/v1/complaints/${id}/attachments`).expect(401);
      await request(server).get(path).expect(401);
      // Not even the operator the complaint names: this is the Authority's case file.
      await request(server).get(path).set(auth(opToken)).expect(403);
    });

    it('hands the Authority the bytes back, as a download and as the type on the file name', async () => {
      const filed = await fileComplaint();
      const uploaded = await attach(filed).expect(201);
      const id = await caseIdFor(filed.referenceNumber);

      const listed = await request(server)
        .get(`/api/v1/complaints/${id}/attachments`)
        .set(auth(adminToken))
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].fileName).toBe('mast.png');

      const res = await request(server)
        .get(`/api/v1/complaints/${id}/attachments/${uploaded.body.id as string}/download`)
        .set(auth(adminToken))
        .expect(200);

      // What comes back is what was sent, byte for byte.
      expect(Buffer.from(res.body as Buffer).equals(PNG)).toBe(true);
      // And how it is served. These three headers are the difference between opening a stranger's
      // file and running it: never inline, never sniffed, never a type the sender chose.
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('serves the type read from the name, not the one the uploader declared', async () => {
      const filed = await fileComplaint();
      // A real PNG, announced by the sender as something a browser would execute.
      const uploaded = await request(server)
        .post('/api/v1/complaints/attachments')
        .field('referenceNumber', filed.referenceNumber)
        .field('trackingCode', filed.trackingCode)
        .attach('file', PNG, { filename: 'mast.png', contentType: 'text/html' })
        .expect(201);
      expect(uploaded.body.mimeType).toBe('image/png');

      const id = await caseIdFor(filed.referenceNumber);
      const res = await request(server)
        .get(`/api/v1/complaints/${id}/attachments/${uploaded.body.id as string}/download`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-type']).not.toContain('text/html');
    });

    it('refuses a file that is a picture in name only', async () => {
      const filed = await fileComplaint();
      const res = await attach(filed, 'photo.png', Buffer.from('<html><body>hello</body></html>'));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/PNG/);
    });

    it('refuses the formats a complaint has no use for', async () => {
      const filed = await fileComplaint();
      const kml = Buffer.from('<?xml version="1.0"?><kml><Document/></kml>');
      await attach(filed, 'coverage.kml', kml).expect(400);
    });

    it('stops at three files', async () => {
      const filed = await fileComplaint();
      await attach(filed, 'one.png').expect(201);
      await attach(filed, 'two.png').expect(201);
      await attach(filed, 'three.png').expect(201);
      const fourth = await attach(filed, 'four.png');
      expect(fourth.status).toBe(400);
      expect(fourth.body.message).toContain('up to 3 files');
    });

    it('refuses new files once the case is closed', async () => {
      const filed = await fileComplaint();
      const id = await caseIdFor(filed.referenceNumber);
      await request(server)
        .patch(`/api/v1/complaints/${id}/status`)
        .set(auth(adminToken))
        .send({ status: 'CLOSED' })
        .expect(200);

      const res = await attach(filed);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/closed/i);
    });

    it('lets an administrator take a file off the case, and nobody below one', async () => {
      const filed = await fileComplaint();
      const uploaded = await attach(filed).expect(201);
      const id = await caseIdFor(filed.referenceNumber);
      const path = `/api/v1/complaints/${id}/attachments/${uploaded.body.id as string}`;

      // A supervisor works the case and can read the file. Removing evidence from it is a
      // different act, and it is not theirs.
      await request(server).get(`${path}/download`).set(auth(supervisorToken)).expect(200);
      await request(server).delete(path).set(auth(supervisorToken)).expect(403);

      await request(server).delete(path).set(auth(adminToken)).expect(200);
      const listed = await request(server)
        .get(`/api/v1/complaints/${id}/attachments`)
        .set(auth(adminToken))
        .expect(200);
      expect(listed.body).toHaveLength(0);
    });
  });
});
