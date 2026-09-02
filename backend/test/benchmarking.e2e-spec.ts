import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
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

jest.setTimeout(30000);
const OTP = '123456';

/**
 * Operator benchmarking (Phase 2). Five MNOs are seeded so the peer group clears the disclosure
 * minimum, plus one ISP that must never appear in an MNO's comparison.
 */
describe('Benchmarking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-bm-admin@nca.test';
  const opEmails = [0, 1, 2, 3, 4].map((i) => `e2e-bm-op${i}@x.test`);
  const ispEmail = 'e2e-bm-isp@x.test';
  const emails = [adminEmail, ...opEmails, ispEmail];
  const licences = [...[0, 1, 2, 3, 4].map((i) => `E2E/BM/MNO${i}`), 'E2E/BM/ISP0'];
  const tplName = 'E2E Benchmark Template';

  let adminToken: string;
  let opTokens: string[] = [];
  let ispToken: string;
  let templateId: string;
  let periodId: string;
  const entityIds: string[] = [];

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
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { in: licences } } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
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

    const opIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const entity = await prisma.entity.create({
        data: {
          name: `BM MNO ${i}`,
          type: EntityType.MNO,
          status: EntityStatus.ACTIVE,
          licenceNumber: licences[i],
        },
      });
      entityIds.push(entity.id);
      const user = await prisma.user.create({
        data: {
          email: opEmails[i],
          passwordHash,
          firstName: `Op${i}`,
          lastName: 'User',
          role: Role.OPERATOR_ADMIN,
          entityId: entity.id,
        },
      });
      opIds.push(user.id);
    }

    const isp = await prisma.entity.create({
      data: {
        name: 'BM ISP 0',
        type: EntityType.ISP,
        status: EntityStatus.ACTIVE,
        licenceNumber: 'E2E/BM/ISP0',
      },
    });
    await prisma.user.create({
      data: {
        email: ispEmail,
        passwordHash,
        firstName: 'Isp',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: isp.id,
      },
    });

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: {
            key: 'market',
            title: 'Market',
            order: 1,
            fields: {
              create: [
                {
                  key: 'bm_subscribers',
                  label: 'Subscribers',
                  order: 1,
                  dataType: FieldType.INTEGER,
                  unit: 'subscribers',
                },
                { key: 'bm_notes', label: 'Notes', order: 2, dataType: FieldType.TEXT },
              ],
            },
          },
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    templateId = tpl.id;
    const numericField = tpl.sections[0].fields.find((f) => f.key === 'bm_subscribers')!;

    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2025 Q4',
        periodStart: new Date('2025-10-01'),
        periodEnd: new Date('2025-12-31'),
        dueDate: new Date('2026-01-15'),
        status: 'CLOSED',
      },
    });
    periodId = period.id;

    // Subscribers, deliberately spread so the median, the rank and the share are all distinct:
    // MNO 0 is the smallest, MNO 4 the market leader.
    const subscribers = [100, 200, 300, 400, 5000];
    let ref = 920000;
    for (let i = 0; i < 5; i++) {
      await prisma.submission.create({
        data: {
          entityId: entityIds[i],
          periodId: period.id,
          templateId: tpl.id,
          createdById: opIds[i],
          // MNO 3 filed late and was sent back, so the compliance metrics are not all identical.
          status: i === 3 ? SubmissionStatus.REJECTED : SubmissionStatus.APPROVED,
          isLate: i === 3,
          submittedAt: new Date('2026-01-10'),
          referenceNumber: `NCA/SUB/2026/${++ref}`,
          values: {
            create: [
              { fieldId: numericField.id, valueText: String(subscribers[i]) },
              { fieldId: tpl.sections[0].fields[1].id, valueText: 'Nothing to add.' },
            ],
          },
        },
      });
    }

    adminToken = await login(adminEmail);
    // One at a time, not Promise.all. Supertest starts an ephemeral listener per request when the
    // Nest server is not already listening, and concurrent requests race on that listen() call —
    // which surfaces as every test in the suite failing with ECONNRESET, roughly one run in four.
    opTokens = [];
    for (const email of opEmails) {
      opTokens.push(await login(email));
    }
    ispToken = await login(ispEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = async (path: string, token: string, query: Record<string, unknown> = {}) =>
    (
      await request(server)
        .get(`/api/v1/benchmarking/${path}`)
        .query({ templateId, ...query })
        .set(auth(token))
        .expect(200)
    ).body;

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/benchmarking/compliance').expect(401);
  });

  describe('compliance', () => {
    it('places an operator among its peers without naming any of them', async () => {
      const body = await get('compliance', opTokens[3], { periodId });
      expect(body.peerGroup.entityType).toBe(EntityType.MNO);
      // MNO 3 was the only one sent back, so its approval rate is the worst of the five.
      expect(body.metrics.approvalRate.value).toBe(0);
      expect(body.metrics.approvalRate.rank).toBe(5);
      expect(body.metrics.approvalRate.median).toBe(1);
      expect(body.metrics.onTimeRate.value).toBe(0);
      // The named table is the Authority's view and must not be in an operator's response.
      expect(body.rows).toEqual([]);
    });

    it('gives the Authority the named table', async () => {
      const body = await get('compliance', adminToken, {
        periodId,
        entityType: EntityType.MNO,
      });
      // The peer group is every active MNO, so a parallel suite's operators belong in it too.
      // What this suite owns is its own five rows.
      const ours = body.rows.filter((r: { entity: { name: string } }) =>
        r.entity.name.startsWith('BM MNO '),
      );
      expect(ours).toHaveLength(5);
      const late = body.rows.find(
        (r: { entity: { name: string } }) => r.entity.name === 'BM MNO 3',
      );
      expect(late).toMatchObject({ filed: 1, late: 1, onTime: 0, rejected: 1, approvalRate: 0 });
      const onTime = body.rows.find(
        (r: { entity: { name: string } }) => r.entity.name === 'BM MNO 0',
      );
      expect(onTime).toMatchObject({ onTime: 1, late: 0, approved: 1, approvalRate: 1 });
    });

    it('compares an operator only against its own kind', async () => {
      const body = await get('compliance', ispToken, { periodId });
      expect(body.peerGroup.entityType).toBe(EntityType.ISP);
      // The lone ISP has no comparable peers, so every aggregate is withheld.
      expect(body.metrics.onTimeRate.withheld).toBe(true);
      expect(body.metrics.onTimeRate.median).toBeNull();
    });
  });

  describe('indicators', () => {
    it('lists the numeric questions and leaves text ones out', async () => {
      const body = await get('indicators', opTokens[0], {});
      const keys = body.indicators.map((i: { fieldKey: string }) => i.fieldKey);
      expect(keys).toContain('bm_subscribers');
      expect(keys).not.toContain('bm_notes');
    });
  });

  describe('indicator', () => {
    it('tells an operator where it stands, and no competitor figure', async () => {
      const body = await get('indicator', opTokens[0], {
        fieldKey: 'bm_subscribers',
        periodId,
      });
      expect(body.field.label).toBe('Subscribers');
      expect(body.period.label).toBe('2025 Q4');
      expect(body.summary.value).toBe(100);
      // Four operators have a comparable figure; MNO 3's return was sent back, so it has none.
      expect(body.summary.rank).toBe(4);
      // Peers are 200, 300 and 5000 -> median 300. The 5000 is not recoverable from that.
      expect(body.summary.median).toBe(300);
      expect(body.summary.withheld).toBe(false);
      expect(body.summary.shareOfTotal).toBeCloseTo(100 / 5600);
      expect(body.rows).toEqual([]);

      // The market leader's exact figure must not appear anywhere in the operator's response.
      expect(JSON.stringify(body)).not.toContain('5000');
    });

    it('gives the Authority every figure by name', async () => {
      const body = await get('indicator', adminToken, {
        fieldKey: 'bm_subscribers',
        periodId,
        entityType: EntityType.MNO,
      });
      const leader = body.rows.find(
        (r: { entity: { name: string } }) => r.entity.name === 'BM MNO 4',
      );
      expect(leader.value).toBe(5000);
      expect(body.reporting).toBe(4); // MNO 3 was rejected, so its figure is not compared
    });

    it('compares approved figures only', async () => {
      const body = await get('indicator', adminToken, {
        fieldKey: 'bm_subscribers',
        periodId,
        entityType: EntityType.MNO,
      });
      const rejected = body.rows.find(
        (r: { entity: { name: string } }) => r.entity.name === 'BM MNO 3',
      );
      expect(rejected.value).toBeNull();
    });

    it('withholds the comparison when the peer group is too small', async () => {
      const body = await get('indicator', ispToken, { fieldKey: 'bm_subscribers' });
      expect(body.summary.withheld).toBe(true);
      expect(body.summary.median).toBeNull();
      expect(body.rows).toEqual([]);
    });

    it('rejects an unknown question (404)', async () => {
      await request(server)
        .get('/api/v1/benchmarking/indicator')
        .query({ fieldKey: 'no_such_question' })
        .set(auth(adminToken))
        .expect(404);
    });

    it('rejects a request with no question named (400)', async () => {
      await request(server).get('/api/v1/benchmarking/indicator').set(auth(adminToken)).expect(400);
    });
  });
});
