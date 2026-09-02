import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  FieldType,
  PublicAggregation,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(45000);
const OTP = '123456';

/**
 * The public open-data endpoints (Q4, Phase 2).
 *
 * The rules under test are the ones that would matter in a complaint from an operator: nothing is
 * public unless NCA put it on the list, no response ever names an operator, and an aggregate over
 * too few operators is withheld rather than published.
 */
describe('Public portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-pub-admin@nca.test';
  const opEmail = 'e2e-pub-op@x.test';
  const emails = [adminEmail, opEmail];
  const licences = [0, 1, 2, 3].map((i) => `E2E/PUB/${i}`);
  const tplName = 'E2E Public Template';
  // Field keys are globally unique in these assertions, so they carry the suite's own prefix.
  const openKey = 'e2e_pub_subscribers';
  const thinKey = 'e2e_pub_thin';
  const revenueKey = 'e2e_pub_revenue';
  const textKey = 'e2e_pub_notes';

  let adminToken: string;
  let opToken: string;
  const created: string[] = [];

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
    await prisma.publicIndicator.deleteMany({
      where: { fieldKey: { in: [openKey, thinKey, revenueKey, textKey] } },
    });
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { in: licences } } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
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

    const entities = [];
    for (let i = 0; i < 4; i++) {
      entities.push(
        await prisma.entity.create({
          data: {
            name: `Pub Op ${i}`,
            type: EntityType.MNO,
            status: EntityStatus.ACTIVE,
            licenceNumber: licences[i],
          },
        }),
      );
    }
    const op = await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Op',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entities[0].id,
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
            key: 'public',
            title: 'Public section',
            order: 1,
            fields: {
              create: [
                {
                  key: openKey,
                  label: 'Subscribers',
                  order: 1,
                  dataType: FieldType.INTEGER,
                  unit: 'subscribers',
                },
                // Reported by one operator only, so an aggregate would name that operator.
                { key: thinKey, label: 'Thin metric', order: 2, dataType: FieldType.INTEGER },
                // The levy basis: commercially sensitive, and refused outright.
                {
                  key: revenueKey,
                  label: 'Annual revenue',
                  order: 3,
                  dataType: FieldType.MONETARY,
                  isLevyBasis: true,
                },
                { key: textKey, label: 'Notes', order: 4, dataType: FieldType.TEXT },
              ],
            },
          },
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    const fields = tpl.sections[0].fields;
    const fieldId = (key: string) => fields.find((f) => f.key === key)!.id;

    const closed = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'QUARTERLY',
        label: '2025 Q2 public',
        periodStart: new Date('2025-04-01'),
        periodEnd: new Date('2025-06-30'),
        dueDate: new Date('2025-07-15'),
        status: 'CLOSED',
      },
    });

    // Four approved returns on a closed period: 100, 200, 300, 400 subscribers.
    const subscribers = [100, 200, 300, 400];
    let ref = 940000;
    for (let i = 0; i < 4; i++) {
      await prisma.submission.create({
        data: {
          entityId: entities[i].id,
          periodId: closed.id,
          templateId: tpl.id,
          createdById: op.id,
          status: SubmissionStatus.APPROVED,
          isLate: false,
          submittedAt: new Date('2025-07-10'),
          referenceNumber: `NCA/SUB/2025/${++ref}`,
          values: {
            create: [
              { fieldId: fieldId(openKey), valueText: String(subscribers[i]) },
              { fieldId: fieldId(textKey), valueText: 'Nothing to add.' },
              // Only the first operator reports the thin metric.
              ...(i === 0 ? [{ fieldId: fieldId(thinKey), valueText: '999' }] : []),
            ],
          },
        },
      });
    }

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface PublicIndicatorRow {
    label: string;
    unit: string | null;
    aggregation: string;
    points: { label: string; value: number | null; contributors: number; withheld: boolean }[];
  }

  /** Only this suite's indicators; another suite may have published its own. */
  const ourIndicators = (body: { indicators: PublicIndicatorRow[] }, label: string) =>
    body.indicators.find((i) => i.label === label);

  const addIndicator = async (body: Record<string, unknown>, expected = 201) => {
    const res = await request(server)
      .post('/api/v1/public-indicators')
      .set(auth(adminToken))
      .send(body)
      .expect(expected);
    if (expected === 201) created.push(res.body.id);
    return res;
  };

  describe('what the public can reach without an account', () => {
    it('serves the overview with no token', async () => {
      const res = await request(server).get('/api/v1/public/overview').expect(200);
      expect(res.body.licensedOperators).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(res.body.byType)).toBe(true);
    });

    it('serves the complaint summary with no token, and names nobody', async () => {
      const res = await request(server).get('/api/v1/public/complaints-summary').expect(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body.byStatus).toHaveProperty('resolved');
      // Nothing identifying: no reference numbers, no subjects, no operator names.
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('NCA/CMP');
      expect(json).not.toContain('complainant');
      expect(json).not.toContain('Pub Op');
    });

    it('publishes nothing until NCA has put something on the list', async () => {
      const res = await request(server).get('/api/v1/public/indicators').expect(200);
      expect(ourIndicators(res.body, 'People connected')).toBeUndefined();
    });
  });

  describe('the allowlist', () => {
    it('lets only an administrator change it (403)', async () => {
      await request(server)
        .post('/api/v1/public-indicators')
        .set(auth(opToken))
        .send({ fieldKey: openKey, label: 'People connected' })
        .expect(403);
    });

    it('is not readable by an operator at all (403)', async () => {
      await request(server).get('/api/v1/public-indicators').set(auth(opToken)).expect(403);
    });

    it('refuses a question that is not on any published questionnaire (400)', async () => {
      await addIndicator({ fieldKey: 'no_such_question', label: 'Nothing' }, 400);
    });

    it('refuses a text question (400)', async () => {
      await addIndicator({ fieldKey: textKey, label: 'Notes' }, 400);
    });

    it('refuses the revenue the levy is assessed on (400)', async () => {
      const res = await addIndicator({ fieldKey: revenueKey, label: 'Revenue' }, 400);
      expect(JSON.stringify(res.body)).toContain('commercially sensitive');
    });

    it('offers the questions that could be published, minus the levy basis', async () => {
      const res = await request(server)
        .get('/api/v1/public-indicators/available')
        .set(auth(adminToken))
        .expect(200);
      const keys = res.body.fields.map((f: { fieldKey: string }) => f.fieldKey);
      expect(keys).toContain(openKey);
      expect(keys).not.toContain(revenueKey);
      expect(keys).not.toContain(textKey);
    });
  });

  describe('publishing a figure', () => {
    it('adds a figure to the list without publishing it', async () => {
      const res = await addIndicator({
        fieldKey: openKey,
        aggregation: PublicAggregation.SUM,
        label: 'People connected',
        unit: 'subscribers',
        description: 'Total mobile subscriptions across licensed operators.',
      });
      expect(res.body.isPublished).toBe(false);

      // Adding and publishing are two separate decisions, so the public page has not changed.
      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      expect(ourIndicators(pub.body, 'People connected')).toBeUndefined();
    });

    it('publishes it once an administrator switches it on', async () => {
      await request(server)
        .patch(`/api/v1/public-indicators/${created[0]}`)
        .set(auth(adminToken))
        .send({ isPublished: true })
        .expect(200);

      const res = await request(server).get('/api/v1/public/indicators').expect(200);
      const indicator = ourIndicators(res.body, 'People connected')!;
      expect(indicator.unit).toBe('subscribers');

      const point = indicator.points.find((p) => p.label === '2025 Q2 public')!;
      expect(point.contributors).toBe(4);
      expect(point.withheld).toBe(false);
      expect(point.value).toBe(1000); // 100 + 200 + 300 + 400
    });

    it('never names an operator in the public response', async () => {
      const res = await request(server).get('/api/v1/public/indicators').expect(200);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('Pub Op');
      expect(json).not.toContain('E2E/PUB');
      expect(json).not.toContain('entityId');
    });

    it('withholds a figure too few operators reported', async () => {
      const res = await addIndicator({
        fieldKey: thinKey,
        label: 'Thin public metric',
        isPublished: true,
      });
      expect(res.body.isPublished).toBe(true);

      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      const indicator = ourIndicators(pub.body, 'Thin public metric')!;
      const point = indicator.points.find((p) => p.label === '2025 Q2 public')!;
      expect(point.contributors).toBe(1);
      expect(point.withheld).toBe(true);
      expect(point.value).toBeNull();
      // The one operator's actual figure must not be recoverable from the response.
      expect(JSON.stringify(pub.body)).not.toContain('999');
    });

    it('averages rather than totals when the schedule says so', async () => {
      const res = await addIndicator({
        fieldKey: openKey,
        aggregation: PublicAggregation.AVERAGE,
        label: 'Average operator size',
        isPublished: true,
      });
      expect(res.body.aggregation).toBe(PublicAggregation.AVERAGE);

      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      const point = ourIndicators(pub.body, 'Average operator size')!.points.find(
        (p) => p.label === '2025 Q2 public',
      )!;
      expect(point.value).toBe(250); // (100 + 200 + 300 + 400) / 4
    });

    it('refuses the same question twice with the same calculation (400)', async () => {
      await addIndicator(
        { fieldKey: openKey, aggregation: PublicAggregation.SUM, label: 'Duplicate' },
        400,
      );
    });

    it('takes a figure off the public site when it is removed', async () => {
      await request(server)
        .delete(`/api/v1/public-indicators/${created[0]}`)
        .set(auth(adminToken))
        .expect(200);

      const pub = await request(server).get('/api/v1/public/indicators').expect(200);
      expect(ourIndicators(pub.body, 'People connected')).toBeUndefined();
    });
  });
});
