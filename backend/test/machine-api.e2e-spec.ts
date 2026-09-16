import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  ApiScope,
  EntityStatus,
  EntityType,
  FieldType,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { sign } from '../src/machine-api/request-signing';

jest.setTimeout(60000);
const OTP = '123456';

/**
 * A throwaway client certificate, generated once and pinned here.
 *
 * Its own rather than borrowed from the signatures suite, for the reason that suite gives about
 * its own: these run four at a time against one database, and a shared certificate fixture would
 * collide on the unique fingerprint whenever two of them overlapped. Self-signed, valid to 2046,
 * and it signs nothing — what is under test is whether the portal recognises it.
 */
const CLIENT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDYzCCAkugAwIBAgIUXcCsLenqBG8SJN3BOYVn4TaVr5gwDQYJKoZIhvcNAQEL
BQAwQTEMMAoGA1UECgwDTkNBMQ0wCwYDVQQLDARURVNUMSIwIAYDVQQDDBlOQ0Eg
UG9ydGFsIE1hY2hpbmUgQ2xpZW50MB4XDTI2MDkxNjA3MDUyM1oXDTQ2MDkxMTA3
MDUyM1owQTEMMAoGA1UECgwDTkNBMQ0wCwYDVQQLDARURVNUMSIwIAYDVQQDDBlO
Q0EgUG9ydGFsIE1hY2hpbmUgQ2xpZW50MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAzSj504juZKjycbpKB0EIQs46XN1N/Z8CTA9EVMGHT4V23g8zz71Y
Ip896tkw1L4yGfUyV/2QtBOKlhHLpKNN+8KmuPLnJqpJnPA218exfBSY/XUiJ+sX
u8aldCzJwUmLqBIirWo4bBAzcsH8Fy/5G9Ym+P8pwmOmsFWyrwtaLqBTv38h+GxM
G6wW/zPWAl/X6fH+/DMEMEW08nhDJSVjSwzz8Qbgr5G7uCsiYJ8oH4+DB2ak7KhX
j2GKMc5fobx0q08n5BmKxBl8QDYk3f78ng1LWgL25bxu9LypP3Vaeb/in9u47z18
cfmt4u1nruWyI6QkGFjh9sOeaUD5LhiyrQIDAQABo1MwUTAdBgNVHQ4EFgQULuyX
oTPblS4VeWHkzkxQUDu+KzYwHwYDVR0jBBgwFoAULuyXoTPblS4VeWHkzkxQUDu+
KzYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAbd7FhkX94TRb
tx/B50nM5psikya0OLmiu1RPG9xzW9iHkbXmhd7rTZnz6NgnDfNllUnoTOshWkHg
YokJbFVP7Tl+NyJAt3SMixn15/MgVMhGai17JwdBe9Y0Okf1DWioo9Mzz4mDyi3U
m1M2dnzmmzgTuAlcHVTun/BpbsOzqeOe647Xhp3sgnhGMUHLnEQxKmXn0sHsudOz
/oqjV8qsJLMR8vXtDoIN2NYtbOdnswbjEPr1ESW4LgayK1d4be3VuM+cZQD+NHZR
5HDaF4+i2v/zReUKHE2A41x2IynUt2KVWTW9U3NeEaXNQSaLhcDhG7C/wr/g+ZbZ
/C1tIfj5LA==
-----END CERTIFICATE-----
`;

/** `openssl x509 -outform DER | openssl dgst -sha256` over the certificate above. */
const CLIENT_CERT_FINGERPRINT = '91636d8bf877f4f60cd32e709f4f3aee078d9eced54e288536cd39c69324c23a';

/**
 * The system-to-system API (Q10, Phase 3).
 *
 * Most of this suite is about the controls rather than the happy path: an unsigned request, a
 * replayed one, a tampered body, a credential used from the wrong address, one that has expired,
 * and one reaching for another operator's data.
 */
describe('Machine API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-mach-admin@nca.test';
  const opAEmail = 'e2e-mach-a@x.test';
  const opBEmail = 'e2e-mach-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/MACH/A', 'E2E/MACH/B'];
  const tplName = 'E2E Machine Template';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let entityAId: string;
  let periodId: string;

  /** The credential this suite files with. */
  let clientId = '';
  let clientSecret = '';
  let credentialRowId = '';

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
    const clients = await prisma.apiClient.findMany({
      where: { entity: { licenceNumber: { in: licences } } },
      select: { id: true, serviceUserId: true },
    });
    await prisma.apiNonce.deleteMany({ where: { clientId: { in: clients.map((c) => c.id) } } });
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { in: licences } } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.enforcementCase.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
    await prisma.apiClient.deleteMany({ where: { id: { in: clients.map((c) => c.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: clients.map((c) => c.serviceUserId) } } });
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
        name: 'Mach A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Mach B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    entityAId = entA.id;
    for (const [email, entityId] of [
      [opAEmail, entA.id],
      [opBEmail, entB.id],
    ] as const) {
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'Op',
          lastName: 'Admin',
          role: Role.OPERATOR_ADMIN,
          entityId,
        },
      });
    }

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: {
            key: 'machine',
            title: 'Machine section',
            order: 1,
            applicableEntityTypes: [EntityType.MNO],
            fields: {
              create: [
                {
                  key: 'mach_subscribers',
                  label: 'Subscribers',
                  order: 1,
                  dataType: FieldType.INTEGER,
                  isMandatory: true,
                },
              ],
            },
          },
        },
      },
    });

    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2026 Q2 machine',
        periodStart: new Date('2026-04-01'),
        periodEnd: new Date('2026-06-30'),
        // Not yet due, so no sweep can open a case against this suite's fixtures.
        dueDate: new Date('2999-07-15'),
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
   * A signed machine call. The body is stringified once and both signed and sent, because a
   * signature is over the bytes that arrive, not over a re-serialised object.
   */
  function call(
    method: 'get' | 'post' | 'put',
    path: string,
    options: {
      body?: unknown;
      secret?: string;
      id?: string;
      nonce?: string;
      timestamp?: string;
      signature?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    const fullPath = `/api/v1${path}`;
    const raw = options.body === undefined ? '' : JSON.stringify(options.body);
    const timestamp = options.timestamp ?? new Date().toISOString();
    const nonce = options.nonce ?? randomUUID();
    const secret = options.secret ?? clientSecret;

    const signature =
      options.signature ?? sign(secret, { timestamp, nonce, method, path: fullPath, body: raw });

    const req = request(server)
      [method](fullPath)
      .set('x-nca-client-id', options.id ?? clientId)
      .set('x-nca-client-secret', secret)
      .set('x-nca-timestamp', timestamp)
      .set('x-nca-nonce', nonce)
      .set('x-nca-signature', signature);

    for (const [k, v] of Object.entries(options.headers ?? {})) req.set(k, v);
    if (options.body !== undefined) req.set('Content-Type', 'application/json').send(raw);
    return req;
  }

  describe('issuing a credential', () => {
    it('will not let a plain submitter issue one (403)', async () => {
      const submitter = await prisma.user.create({
        data: {
          email: 'e2e-mach-sub@x.test',
          passwordHash: await hashPassword(PASSWORD),
          firstName: 'Sub',
          lastName: 'Mitter',
          role: Role.OPERATOR_SUBMITTER,
          entityId: entityAId,
        },
      });
      const token = await login('e2e-mach-sub@x.test');
      await request(server)
        .post('/api/v1/api-clients')
        .set(auth(token))
        .send({ name: 'Nope', scopes: [ApiScope.SUBMIT_RETURNS] })
        .expect(403);
      await prisma.user.delete({ where: { id: submitter.id } });
    });

    it('refuses a credential that may do nothing (400)', async () => {
      await request(server)
        .post('/api/v1/api-clients')
        .set(auth(opAToken))
        .send({ name: 'Empty', scopes: [] })
        .expect(400);
    });

    it('refuses a fingerprint that is not a SHA-256 one (400)', async () => {
      const res = await request(server)
        .post('/api/v1/api-clients')
        .set(auth(opAToken))
        .send({
          name: 'Bad cert',
          scopes: [ApiScope.SUBMIT_RETURNS],
          // A SHA-1 fingerprint: the right shape, the wrong length.
          certFingerprint: 'a'.repeat(40),
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('64 hexadecimal');
    });

    it('refuses an address range it could never match (400)', async () => {
      await request(server)
        .post('/api/v1/api-clients')
        .set(auth(opAToken))
        .send({
          name: 'Bad range',
          scopes: [ApiScope.SUBMIT_RETURNS],
          allowedCidrs: ['not-a-range'],
        })
        .expect(400);
    });

    it('issues one, returning the secret exactly once', async () => {
      const res = await request(server)
        .post('/api/v1/api-clients')
        .set(auth(opAToken))
        .send({
          name: 'Billing system',
          scopes: [ApiScope.READ_PERIODS, ApiScope.READ_RETURNS, ApiScope.SUBMIT_RETURNS],
        })
        .expect(201);

      clientId = res.body.clientId;
      clientSecret = res.body.clientSecret;
      credentialRowId = res.body.id;

      expect(clientId).toMatch(/^nca_[0-9a-f]{24}$/);
      expect(clientSecret).toEqual(expect.any(String));
      expect(res.body.secretLast4).toBe(clientSecret.slice(-4));
      // A default expiry, because a key with no expiry is a key nobody rotates.
      expect(res.body.expiresAt).not.toBeNull();

      // Listing never shows it again.
      const list = await request(server).get('/api/v1/api-clients').set(auth(opAToken)).expect(200);
      const row = list.body.find((c: { id: string }) => c.id === credentialRowId);
      expect(row).toBeDefined();
      expect(row.clientSecret).toBeUndefined();
      expect(row.secretHash).toBeUndefined();
    });

    it('creates a service account that cannot log in and is not on the team list', async () => {
      const credential = await prisma.apiClient.findUnique({
        where: { id: credentialRowId },
        select: { serviceUser: { select: { id: true, email: true, isServiceAccount: true } } },
      });
      expect(credential!.serviceUser.isServiceAccount).toBe(true);

      // Not a way in. The response is the same one an unknown address gets.
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: credential!.serviceUser.email, password: PASSWORD })
        .expect(401);

      // And not on the operator's team list, where every other row is a person.
      const team = await request(server)
        .get('/api/v1/operator/users')
        .set(auth(opAToken))
        .expect(200);
      const ids = team.body.data.map((u: { id: string }) => u.id);
      expect(ids).not.toContain(credential!.serviceUser.id);
    });

    it('will not let anyone edit or delete a service account through the team screens', async () => {
      const credential = await prisma.apiClient.findUnique({
        where: { id: credentialRowId },
        select: { serviceUserId: true },
      });
      const serviceUserId = credential!.serviceUserId;

      // An administrator could otherwise promote it, which would hand a machine credential a role
      // nobody granted it.
      await request(server)
        .patch(`/api/v1/users/${serviceUserId}`)
        .set(auth(adminToken))
        .send({ role: Role.ADMIN })
        .expect(404);
      await request(server)
        .delete(`/api/v1/users/${serviceUserId}`)
        .set(auth(adminToken))
        .expect(404);

      // And an operator admin could otherwise reach it through their own team screen, because the
      // account genuinely belongs to their entity.
      await request(server)
        .patch(`/api/v1/operator/users/${serviceUserId}`)
        .set(auth(opAToken))
        .send({ isActive: false })
        .expect(404);
      await request(server)
        .delete(`/api/v1/operator/users/${serviceUserId}`)
        .set(auth(opAToken))
        .expect(404);

      // Still exactly as it was.
      const after = await prisma.user.findUnique({
        where: { id: serviceUserId },
        select: { role: true, isActive: true, deletedAt: true },
      });
      expect(after).toMatchObject({
        role: Role.OPERATOR_SUBMITTER,
        isActive: true,
        deletedAt: null,
      });
    });

    it('shows an operator only its own credentials', async () => {
      const list = await request(server).get('/api/v1/api-clients').set(auth(opBToken)).expect(200);
      expect(list.body.every((c: { entity: { id: string } }) => c.entity.id !== entityAId)).toBe(
        true,
      );
    });
  });

  describe('the controls on every call', () => {
    it('refuses a request with no credentials (401)', async () => {
      await request(server).get('/api/v1/machine/whoami').expect(401);
    });

    it('refuses an unknown client id, without saying it is unknown (401)', async () => {
      const res = await call('get', '/machine/whoami', {
        id: 'nca_deadbeefdeadbeefdeadbeef',
      }).expect(401);
      expect(JSON.stringify(res.body ?? {})).not.toContain('unknown');
    });

    it('refuses a bad secret with the same message as an unknown id (401)', async () => {
      const bad = await call('get', '/machine/whoami', { secret: 'not-the-secret' }).expect(401);
      const unknown = await call('get', '/machine/whoami', {
        id: 'nca_deadbeefdeadbeefdeadbeef',
      }).expect(401);
      expect(bad.body.message).toBe(unknown.body.message);
    });

    it('accepts a properly signed request', async () => {
      const res = await call('get', '/machine/whoami').expect(200);
      expect(res.body.clientId).toBe(clientId);
      expect(res.body.entityId).toBe(entityAId);
      expect(res.body.scopes).toContain(ApiScope.SUBMIT_RETURNS);
    });

    it('refuses a request that is not signed (401)', async () => {
      await request(server)
        .get('/api/v1/machine/whoami')
        .set('x-nca-client-id', clientId)
        .set('x-nca-client-secret', clientSecret)
        .expect(401);
    });

    it('refuses a signature made over a different path (401)', async () => {
      const timestamp = new Date().toISOString();
      const nonce = randomUUID();
      const elsewhere = sign(clientSecret, {
        timestamp,
        nonce,
        method: 'get',
        path: '/api/v1/machine/periods',
        body: '',
      });
      await call('get', '/machine/whoami', { timestamp, nonce, signature: elsewhere }).expect(401);
    });

    it('refuses a body changed after it was signed (401)', async () => {
      const timestamp = new Date().toISOString();
      const nonce = randomUUID();
      const honest = JSON.stringify({ periodId });
      const signature = sign(clientSecret, {
        timestamp,
        nonce,
        method: 'post',
        path: '/api/v1/machine/returns',
        body: honest,
      });

      await request(server)
        .post('/api/v1/machine/returns')
        .set('x-nca-client-id', clientId)
        .set('x-nca-client-secret', clientSecret)
        .set('x-nca-timestamp', timestamp)
        .set('x-nca-nonce', nonce)
        .set('x-nca-signature', signature)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ periodId: randomUUID() }))
        .expect(401);
    });

    it('refuses a stale request (401)', async () => {
      const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const res = await call('get', '/machine/whoami', { timestamp: old }).expect(401);
      expect(res.body.message).toContain('too old');
    });

    it('refuses a request dated in the future (401)', async () => {
      const ahead = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const res = await call('get', '/machine/whoami', { timestamp: ahead }).expect(401);
      expect(res.body.message).toContain('future');
    });

    it('refuses the same signed request twice (401)', async () => {
      const nonce = randomUUID();
      const timestamp = new Date().toISOString();
      await call('get', '/machine/whoami', { nonce, timestamp }).expect(200);
      const replay = await call('get', '/machine/whoami', { nonce, timestamp }).expect(401);
      expect(replay.body.message).toContain('already been received');
    });

    it('refuses a credential used from an address it is not allowed from (403)', async () => {
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ allowedCidrs: ['198.51.100.0/24'] })
        .expect(200);

      const res = await call('get', '/machine/whoami').expect(403);
      expect(res.body.message).toContain('from this address');

      // Put it back, and confirm the loopback address the tests call from is allowed again.
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ allowedCidrs: [] })
        .expect(200);
      await call('get', '/machine/whoami').expect(200);
    });

    it('refuses a credential bound to a certificate that was not presented (403)', async () => {
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ certFingerprint: 'f'.repeat(64) })
        .expect(200);

      const res = await call('get', '/machine/whoami').expect(403);
      expect(res.body.message).toContain('client certificate');

      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ certFingerprint: '' })
        .expect(200);
      await call('get', '/machine/whoami').expect(200);
    });

    it('ignores a certificate header while no header name is configured', async () => {
      /*
       * The security property the whole setting rests on (NCA, 16 September 2026).
       *
       * Reading a client-certificate header unconditionally would be worse than not checking
       * certificates at all: anyone could set the header themselves and claim any certificate. So
       * the header is honoured only when `MACHINE_CLIENT_CERT_HEADER` names it, and this app was
       * booted without that setting.
       *
       * The credential below is bound to a certificate, and the request presents the correct one
       * in the header a configured deployment would use. It must still be refused, because this
       * deployment was never told to believe that header.
       */
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ certFingerprint: CLIENT_CERT_FINGERPRINT })
        .expect(200);

      try {
        const res = await call('get', '/machine/whoami', {
          headers: { 'x-ssl-client-cert': encodeURIComponent(CLIENT_CERT_PEM) },
        }).expect(403);
        expect(res.body.message).toContain('client certificate');
      } finally {
        /*
         * Unbound whatever happened above.
         *
         * Every test after this one files with the same credential, so leaving it bound to a
         * certificate turns one honest failure into a dozen misleading ones. Found exactly that
         * way: breaking the guard on purpose to check this test could fail took eleven others down
         * with it, and the real cause was three screens up.
         */
        await request(server)
          .patch(`/api/v1/api-clients/${credentialRowId}`)
          .set(auth(opAToken))
          .send({ certFingerprint: '' })
          .expect(200);
      }
      await call('get', '/machine/whoami').expect(200);
    });

    it('refuses a scope the credential does not hold (403)', async () => {
      // This credential was issued without FEED_INGEST, and periods needs READ_PERIODS.
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ scopes: [ApiScope.READ_RETURNS] })
        .expect(200);

      const res = await call('get', '/machine/periods').expect(403);
      expect(res.body.message).toContain('not allowed');

      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({
          scopes: [ApiScope.READ_PERIODS, ApiScope.READ_RETURNS, ApiScope.SUBMIT_RETURNS],
        })
        .expect(200);
    });

    it('writes both acceptances and refusals to the audit trail', async () => {
      const accepted = await prisma.auditLog.count({
        where: { action: 'API_REQUEST_ACCEPTED', entityId: credentialRowId },
      });
      const refused = await prisma.auditLog.count({
        where: { action: 'API_REQUEST_REFUSED', entityId: credentialRowId },
      });
      expect(accepted).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
    });
  });

  describe('filing a return', () => {
    let returnId = '';

    it('lists the periods that are open for this operator', async () => {
      const res = await call('get', '/machine/periods').expect(200);
      const ours = res.body.periods.find((p: { id: string }) => p.id === periodId);
      expect(ours).toBeDefined();
      expect(ours.filed).toBeNull();
    });

    it('describes the questions by key', async () => {
      const res = await call('get', `/machine/periods/${periodId}/questions`).expect(200);
      const keys = res.body.sections.flatMap((s: { fields: { key: string }[] }) =>
        s.fields.map((f) => f.key),
      );
      expect(keys).toContain('mach_subscribers');
    });

    it('opens a draft, and hands back the same one on a second call', async () => {
      const first = await call('post', '/machine/returns', { body: { periodId } }).expect(201);
      returnId = first.body.id;
      const second = await call('post', '/machine/returns', { body: { periodId } }).expect(201);
      expect(second.body.id).toBe(returnId);
    });

    it('refuses a question that is not on the questionnaire, by name (400)', async () => {
      const res = await call('put', `/machine/returns/${returnId}/values`, {
        body: { values: [{ key: 'not_a_question', value: '1' }] },
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('not_a_question');
    });

    it('saves values addressed by key', async () => {
      await call('put', `/machine/returns/${returnId}/values`, {
        body: { values: [{ key: 'mach_subscribers', value: '12345' }] },
      }).expect(200);

      const saved = await prisma.submissionValue.findFirst({
        where: { submissionId: returnId, field: { key: 'mach_subscribers' } },
        select: { valueText: true },
      });
      expect(saved!.valueText).toBe('12345');
    });

    it('files the return, attributing it to the integration', async () => {
      const res = await call('post', `/machine/returns/${returnId}/submit`, { body: {} }).expect(
        201,
      );
      expect(res.body.status).not.toBe(SubmissionStatus.DRAFT);

      const filed = await prisma.submission.findUnique({
        where: { id: returnId },
        select: { signedName: true, submittedAt: true, createdById: true },
      });
      expect(filed!.submittedAt).not.toBeNull();
      expect(filed!.signedName).toBe('Billing system');

      // The author is the credential's own service account, so "who filed this?" has an answer.
      const author = await prisma.user.findUnique({
        where: { id: filed!.createdById },
        select: { isServiceAccount: true },
      });
      expect(author!.isServiceAccount).toBe(true);
    });

    it('shows the filed return back to the machine', async () => {
      const res = await call('get', '/machine/returns').expect(200);
      expect(res.body.returns.some((r: { id: string }) => r.id === returnId)).toBe(true);
    });

    it('will not touch another operator return (404)', async () => {
      const otherEntity = await prisma.entity.findFirst({
        where: { licenceNumber: licences[1] },
        select: { id: true },
      });
      const opB = await prisma.user.findUnique({
        where: { email: opBEmail },
        select: { id: true },
      });
      const theirs = await prisma.submission.create({
        data: {
          entityId: otherEntity!.id,
          periodId,
          templateId: (await prisma.reportingPeriod.findUnique({
            where: { id: periodId },
            select: { templateId: true },
          }))!.templateId,
          createdById: opB!.id,
          status: SubmissionStatus.DRAFT,
          referenceNumber: 'NCA/SUB/2026/950001',
        },
      });

      await call('put', `/machine/returns/${theirs.id}/values`, {
        body: { values: [{ key: 'mach_subscribers', value: '1' }] },
      }).expect(404);
    });
  });

  describe('rotating and revoking', () => {
    it('rotates the secret, and the old one stops working at once', async () => {
      const old = clientSecret;
      const res = await request(server)
        .post(`/api/v1/api-clients/${credentialRowId}/rotate`)
        .set(auth(opAToken))
        .expect(201);

      expect(res.body.clientSecret).not.toBe(old);
      await call('get', '/machine/whoami', { secret: old }).expect(401);

      clientSecret = res.body.clientSecret;
      await call('get', '/machine/whoami').expect(200);
    });

    it('refuses a suspended credential (401)', async () => {
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await call('get', '/machine/whoami').expect(401);

      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ status: 'ACTIVE' })
        .expect(200);
      await call('get', '/machine/whoami').expect(200);
    });

    it('refuses an expired credential (401)', async () => {
      await prisma.apiClient.update({
        where: { id: credentialRowId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await call('get', '/machine/whoami').expect(401);
      expect(res.body.message).toContain('expired');

      await prisma.apiClient.update({
        where: { id: credentialRowId },
        data: { expiresAt: new Date(Date.now() + 86_400_000) },
      });
    });

    it('revokes for good, and will not take it back', async () => {
      await request(server)
        .delete(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .expect(200);

      await call('get', '/machine/whoami').expect(401);

      // A revoked credential cannot be edited back into life.
      await request(server)
        .patch(`/api/v1/api-clients/${credentialRowId}`)
        .set(auth(opAToken))
        .send({ status: 'ACTIVE' })
        .expect(400);

      // The service account goes quiet with it, but the row survives so the trail does too.
      const credential = await prisma.apiClient.findUnique({
        where: { id: credentialRowId },
        select: { serviceUser: { select: { isActive: true } } },
      });
      expect(credential!.serviceUser.isActive).toBe(false);
    });
  });
});
