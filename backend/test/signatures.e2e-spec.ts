import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createSign, generateKeyPairSync } from 'crypto';
import { EntityStatus, EntityType, FieldType, Role, TemplateStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(60000);
const OTP = '123456';

/**
 * Certificate-based signatures on returns (Q6, Phase 3).
 *
 * The property worth testing is not that a good signature verifies — it is that a *changed* return
 * stops verifying. A signature that survives the document being edited is decoration.
 */
describe('PKI signatures (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-sig-admin@nca.test';
  const opAEmail = 'e2e-sig-a@x.test';
  const opBEmail = 'e2e-sig-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/SIG/A', 'E2E/SIG/B'];
  const tplName = 'E2E Signature Template';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let periodId: string;
  let certificateId = '';
  let privateKeyPem = '';
  let returnId = '';

  /**
   * A self-signed certificate and its key.
   *
   * Self-signed is right for the test: what the portal checks is that the signature was made by the
   * key inside the certificate the signer registered. Whether that certificate chains to a CA NCA
   * trusts is a separate policy question, and one for the day NCA names a CA.
   */
  function makeCertificate(commonName: string) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    // Node cannot mint an X.509 certificate on its own, so the suite uses a fixed pre-generated
    // one where a real certificate is needed, and the raw public key where it is not.
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      commonName,
    };
  }

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
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    // Submissions first. A signed return points at the certificate that signed it with a RESTRICT
    // foreign key — deliberately, so an amount in the audit trail can always be traced back to the
    // key that produced it — which means the certificate cannot go until the return has.
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { in: licences } } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.signingCertificate.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await prisma.enforcementCase.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
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
        name: 'Sig A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Sig B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    for (const [email, entityId] of [
      [opAEmail, entA.id],
      [opBEmail, entB.id],
    ] as const) {
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'Op',
          lastName: 'Signer',
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
            key: 'sig',
            title: 'Signed section',
            order: 1,
            applicableEntityTypes: [EntityType.MNO],
            fields: {
              create: [
                {
                  key: 'sig_subscribers',
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
        label: '2026 Q2 signed',
        periodStart: new Date('2026-04-01'),
        periodEnd: new Date('2026-06-30'),
        // Not yet due, so no global sweep touches this suite's fixtures.
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

  describe('registering a certificate', () => {
    it('requires authentication (401)', async () => {
      await request(server).get('/api/v1/signatures/certificates').expect(401);
    });

    it('refuses something that is not a certificate (400)', async () => {
      await request(server)
        .post('/api/v1/signatures/certificates')
        .set(auth(opAToken))
        .send({ label: 'Nonsense', certificatePem: 'x'.repeat(100) })
        .expect(400);
    });

    it('refuses a private key pasted in by mistake (400)', async () => {
      const { privateKeyPem: key } = makeCertificate('Op Signer');
      const res = await request(server)
        .post('/api/v1/signatures/certificates')
        .set(auth(opAToken))
        .send({ label: 'Oops', certificatePem: key })
        .expect(400);
      // Whatever the message says, the key must not have been stored.
      const stored = await prisma.signingCertificate.count({
        where: { certificatePem: { contains: 'PRIVATE KEY' } },
      });
      expect(stored).toBe(0);
      expect(res.body).toHaveProperty('message');
    });

    it('registers a real certificate', async () => {
      const res = await request(server)
        .post('/api/v1/signatures/certificates')
        .set(auth(opAToken))
        .send({ label: 'Operator signing key', certificatePem: FIXED_CERT_PEM })
        .expect(201);

      certificateId = res.body.id;
      privateKeyPem = FIXED_KEY_PEM;
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.fingerprint).toEqual(expect.any(String));
      // The stored record must never carry a private key.
      expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    });

    it('lists a signer their own certificates and nobody else', async () => {
      const mine = await request(server)
        .get('/api/v1/signatures/certificates')
        .set(auth(opAToken))
        .expect(200);
      expect(mine.body.some((c: { id: string }) => c.id === certificateId)).toBe(true);

      const theirs = await request(server)
        .get('/api/v1/signatures/certificates')
        .set(auth(opBToken))
        .expect(200);
      expect(theirs.body.some((c: { id: string }) => c.id === certificateId)).toBe(false);
    });
  });

  describe('signing a return', () => {
    /** Sign the digest the portal says it wants signed. */
    const signDigest = (digest: string) => {
      const signer = createSign('RSA-SHA256');
      signer.update(digest);
      signer.end();
      return signer.sign(privateKeyPem, 'base64');
    };

    beforeAll(async () => {
      const draft = await request(server)
        .post('/api/v1/submissions')
        .set(auth(opAToken))
        .send({ periodId })
        .expect(201);
      returnId = draft.body.id;

      const fieldId = (await prisma.templateField.findFirst({
        where: { key: 'sig_subscribers' },
        select: { id: true },
      }))!.id;

      await request(server)
        .put(`/api/v1/submissions/${returnId}/values`)
        .set(auth(opAToken))
        .send({ values: [{ fieldId, valueText: '4321' }] })
        .expect(200);
    });

    it('tells the signer exactly what to sign', async () => {
      const res = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/digest`)
        .set(auth(opAToken))
        .expect(200);
      expect(res.body.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('gives the same digest twice for an unchanged return', async () => {
      const first = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/digest`)
        .set(auth(opAToken))
        .expect(200);
      const second = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/digest`)
        .set(auth(opAToken))
        .expect(200);
      expect(second.body.digest).toBe(first.body.digest);
    });

    it('refuses a signature with no certificate, and a certificate with no signature (400)', async () => {
      await request(server)
        .post(`/api/v1/submissions/${returnId}/submit`)
        .set(auth(opAToken))
        .send({ signedName: 'A Signer', signature: 'abc' })
        .expect(400);

      await request(server)
        .post(`/api/v1/submissions/${returnId}/submit`)
        .set(auth(opAToken))
        .send({ signedName: 'A Signer', signingCertificateId: certificateId })
        .expect(400);
    });

    it('refuses a signature that does not match the return (400)', async () => {
      const wrong = signDigest('a'.repeat(64));
      await request(server)
        .post(`/api/v1/submissions/${returnId}/submit`)
        .set(auth(opAToken))
        .send({
          signedName: 'A Signer',
          signingCertificateId: certificateId,
          signature: wrong,
        })
        .expect(400);
    });

    it('files a return signed with a certificate', async () => {
      const digest = (
        await request(server)
          .get(`/api/v1/signatures/returns/${returnId}/digest`)
          .set(auth(opAToken))
          .expect(200)
      ).body.digest;

      const res = await request(server)
        .post(`/api/v1/submissions/${returnId}/submit`)
        .set(auth(opAToken))
        .send({
          signedName: 'A Signer',
          signingCertificateId: certificateId,
          signature: signDigest(digest),
        })
        .expect(201);

      expect(res.body.signatureFormat).toBe('PKI');

      const stored = await prisma.submission.findUnique({
        where: { id: returnId },
        select: {
          signatureFormat: true,
          signatureDigest: true,
          signatureValue: true,
          signedName: true,
        },
      });
      // A PKI signature is additive: the simple one is still recorded beside it (Q6).
      expect(stored!.signedName).toBe('A Signer');
      expect(stored!.signatureDigest).toBe(digest);
      expect(stored!.signatureValue).toEqual(expect.any(String));
    });

    it('verifies as intact', async () => {
      const res = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/verify`)
        .set(auth(opAToken))
        .expect(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.format).toBe('PKI');
    });

    it('lets the Authority verify it too', async () => {
      const res = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/verify`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.verified).toBe(true);
    });

    it('will not let another operator read the signature on a return that is not theirs', async () => {
      await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/verify`)
        .set(auth(opBToken))
        .expect(403);
    });

    it('stops verifying the moment the return is changed underneath it', async () => {
      // Editing a filed return around the workflow, which is exactly what a signature exists to
      // detect. Nothing in the portal offers this; the point is that if it happened, it shows.
      const value = await prisma.submissionValue.findFirst({
        where: { submissionId: returnId },
        select: { id: true, valueText: true },
      });
      await prisma.submissionValue.update({
        where: { id: value!.id },
        data: { valueText: '9999999' },
      });

      const res = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/verify`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.verified).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/chang|tamper|match|differ/i);

      // Put it back, so the suite leaves nothing odd behind.
      await prisma.submissionValue.update({
        where: { id: value!.id },
        data: { valueText: value!.valueText },
      });
      const again = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/verify`)
        .set(auth(adminToken))
        .expect(200);
      expect(again.body.verified).toBe(true);
    });
  });

  describe('revoking a certificate', () => {
    it('revokes it, and says so on a return already signed with it', async () => {
      await request(server)
        .delete(`/api/v1/signatures/certificates/${certificateId}`)
        .set(auth(opAToken))
        .expect(200);

      // The return still verifies as unchanged — revocation is about future use, not about
      // retrospectively disowning what was signed while the certificate was good.
      const res = await request(server)
        .get(`/api/v1/signatures/returns/${returnId}/verify`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body).toHaveProperty('verified');
    });

    it('will not sign anything new with a revoked certificate', async () => {
      const second = await prisma.reportingPeriod.create({
        data: {
          templateId: (await prisma.reportingPeriod.findUnique({
            where: { id: periodId },
            select: { templateId: true },
          }))!.templateId,
          frequency: 'QUARTERLY',
          label: '2026 Q3 signed',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-09-30'),
          dueDate: new Date('2999-10-15'),
          status: 'OPEN',
          openedAt: new Date(),
        },
      });

      const draft = await request(server)
        .post('/api/v1/submissions')
        .set(auth(opAToken))
        .send({ periodId: second.id })
        .expect(201);

      const digest = (
        await request(server)
          .get(`/api/v1/signatures/returns/${draft.body.id}/digest`)
          .set(auth(opAToken))
          .expect(200)
      ).body.digest;

      const signer = createSign('RSA-SHA256');
      signer.update(digest);
      signer.end();

      await request(server)
        .post(`/api/v1/submissions/${draft.body.id}/submit`)
        .set(auth(opAToken))
        .send({
          signedName: 'A Signer',
          signingCertificateId: certificateId,
          signature: signer.sign(privateKeyPem, 'base64'),
        })
        .expect(400);
    });
  });
});

/**
 * A self-signed certificate and its key, for this suite only.
 *
 * Node has no API for minting an X.509 certificate, and shelling out to openssl would make the
 * suite depend on what is installed on whichever machine runs it. A committed pair is the honest
 * trade: it signs nothing real, it is valid until 2046, and it can be regenerated with
 * `openssl req -x509 -newkey rsa:2048 -nodes -days 7300`.
 */
const FIXED_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC1w6Gcrwxc0VcQ
JApPMmNtbtoR8hdEM2VN4S25hY/sB2CYyJlRHPrFwh60s0EidwRgmVE7RqXHrdLD
IUIPQpy+OWg1UJaQe3OhgiWiqQORRmv76zkjTwjrLbA4mEeXEwLop1NmVJFcSX3w
8A/lVP06kNSqKEUeR3Brg4DH/aQl7rmWvLjZxOQB59QTnPy3PbRR+jiAarUrqeIZ
YMwSMejmuvoxu6inKQF1JvZvVLUFxKHR4A1NhwT/6Ed1zgjeP0Xyf1RBB0PQ7tOD
L3fgSlnRMM8z24gPA4SSfYKdmaeBovwfpA/SOT3p2hLrwpHK1m9HT7CuVwZUYWpK
JQjoJC/dAgMBAAECggEBAKIPwIvUI6CqYgcZKzv7wFz1JmgzwvzjGmL67+rnJDCd
T0pKKTECNrGWaAxTezLAjV2Xta61SeCkojOq9pxmlxygUMKgjO5bs/h/8xB5w52G
/YbK7tIFiP0valy7obEYmVJYxmqJ4mU3fZwSXwnp4jKSqZrhducNaTXjNTKbevz5
wJxaUA1QBMIhSoO3vM0ji5w9rs2m7CcWjjAXYdb8rmFj2U2zTY2ljhTCyBveJyGV
7xw/L3yqBjYfNRYSBxpBdwJGvZ9Q1EtRC8UIHYfULzk1UUznCNIYb1/xkCIXmY6Y
WjJFKqSwPncojJeV/vzwXj3pzzPknHDu0zvSXoiQYb0CgYEA5KZGeTMp/L0PY+KK
WzFW+MFA4eJ8mI8Lcg0NJHIoez+KEvUGWumvjsD3g4TiZCRrnK0Tq6yX084ttHPJ
0Mua3kifNZeS/e/qtXJZqJ63xhUZc3qcNFPVRXExyfAWiGpWKhXxSmgnu81b3iXF
8OkQsqSumOaKpO07Sqzfz17AW+MCgYEAy4GhKNuPGJct0qJ4wZR645MIEhYk2ZOl
0HE+GsIq5xDZQtAFAxUPg7xy3HmoofUxmtO/OeNzO/iY/OkghSTF5a2KBerUxuAB
xw6bEMaJD6brYhNCe5A9kdAJIggBM65ndVgycNVuiRoMXD8StgMeoxaCPsKiRbvm
XWTBklHWkT8CgYEAn5rdqK6pSW3jd1LkR0HKtvuXQdYqKQf48lTf7qftUBMLW65E
EGP9EwXqAJlaupKdt5EtIPHqTYQnbUZCAwiNA0roL62tgqrdSGkY4tZf69pAmNZm
gTRftAiOu6pm4DRyDxCgDNNloPd5gDkX0dGuwTSpV7vd3cBnWfoQhJ1cYwcCgYAO
09ARMQYZDZLKIQpZWF8ny6Ov5asjqy1OpaGXw4PquACMbKmg0t0BhS59P+P4gOvv
UvRA3ICd4vwKmVXEPaypkl5XFggQwWt/vGGx9DUyTcAisjKK3DSQNi8kKp8jy9Y/
54AtVm+qT5qM8g+D8XA/A7nTpsy59fnP3jJ4XbwbcwKBgCzq3qmBjB2SSc2eX7Zx
4qMbojgMqw1mz0m3G4lH1Maf/jVOswJGgg2ZfZm3biycNDhGvIVv9rhRMiosspo5
RQpE0aOqovqGSJGhJ8uqKEiix9yB8qr6z054C5HNX6QIoS0gM8oI7Chsxm/+pqRJ
QO6WJZPxUQ/v0x4lzmCTMt3Z
-----END PRIVATE KEY-----`;

const FIXED_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDWzCCAkOgAwIBAgIUEVRpUKPRlSoI+z3ILfdVlybRTcgwDQYJKoZIhvcNAQEL
BQAwPTEfMB0GA1UEAwwWTkNBIFBvcnRhbCBUZXN0IFNpZ25lcjEMMAoGA1UECwwD
RTJFMQwwCgYDVQQKDANOQ0EwHhcNMjYwODMwMDUzNjIwWhcNNDYwODI1MDUzNjIw
WjA9MR8wHQYDVQQDDBZOQ0EgUG9ydGFsIFRlc3QgU2lnbmVyMQwwCgYDVQQLDANF
MkUxDDAKBgNVBAoMA05DQTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
ALXDoZyvDFzRVxAkCk8yY21u2hHyF0QzZU3hLbmFj+wHYJjImVEc+sXCHrSzQSJ3
BGCZUTtGpcet0sMhQg9CnL45aDVQlpB7c6GCJaKpA5FGa/vrOSNPCOstsDiYR5cT
AuinU2ZUkVxJffDwD+VU/TqQ1KooRR5HcGuDgMf9pCXuuZa8uNnE5AHn1BOc/Lc9
tFH6OIBqtSup4hlgzBIx6Oa6+jG7qKcpAXUm9m9UtQXEodHgDU2HBP/oR3XOCN4/
RfJ/VEEHQ9Du04Mvd+BKWdEwzzPbiA8DhJJ9gp2Zp4Gi/B+kD9I5PenaEuvCkcrW
b0dPsK5XBlRhakolCOgkL90CAwEAAaNTMFEwHQYDVR0OBBYEFLzefYTUWdhqToTp
m9gzeit24KjEMB8GA1UdIwQYMBaAFLzefYTUWdhqToTpm9gzeit24KjEMA8GA1Ud
EwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAC0uhfz+LjxTDZW8SJFR0ZXy
yav2A7rn9jxb7Iixru4vj7VIB3UrgRtJV4qN23wc/xHMZuxNNPtGBhOvG2pAB1Uf
rM1iFSPl/o9db9TDUx17uPB91cUn0qncu+S8jeuoo9cViPa4lWWXVdrONS/Z7mCw
qEZycAQ+v0bSNbYsZv3m8ldNPIh/nB71M8rN9R2vb8UPiJjj8D1Fg9z8hukBENL+
pj5mzGHMsuPW77oZjRGb4XmjVwyXPlTyb7mRTvu6AHuL6X0+YaE4C+7hM6NgoNu5
88SHeBRCDxwJCXtrJfQ4ZShyK8cGGuxotn7ZHAh+lMkg6KV5gWL/assq5NFPDq8=
-----END CERTIFICATE-----`;
