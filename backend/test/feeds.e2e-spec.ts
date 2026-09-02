import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgreementStatus, EntityStatus, EntityType, FeedFrequency, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(60000);
const OTP = '123456';

/**
 * Data-sharing agreements and network feeds (Q10, Phase 3).
 *
 * The two rules this suite exists to hold down: a feed whose agreement is not in force collects
 * nothing, and the portal will not be talked into calling an address on its own network.
 */
describe('Network feeds (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-feed-admin@nca.test';
  const opAEmail = 'e2e-feed-a@x.test';
  const opBEmail = 'e2e-feed-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/FEED/A', 'E2E/FEED/B'];
  const references = ['E2E/DSA/001', 'E2E/DSA/002'];

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let entityAId: string;
  let entityBId: string;
  let activeAgreementId = '';
  let draftAgreementId = '';

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
    const agreements = await prisma.dataSharingAgreement.findMany({
      where: { reference: { in: references } },
      select: { id: true },
    });
    const ids = agreements.map((a) => a.id);
    const feeds = await prisma.networkFeed.findMany({
      where: { agreementId: { in: ids } },
      select: { id: true },
    });
    await prisma.feedMetric.deleteMany({
      where: { feedRun: { feedId: { in: feeds.map((f) => f.id) } } },
    });
    await prisma.feedRun.deleteMany({ where: { feedId: { in: feeds.map((f) => f.id) } } });
    await prisma.networkFeed.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.feedMetric.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
    await prisma.dataSharingAgreement.deleteMany({ where: { id: { in: ids } } });
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
        name: 'Feed A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Feed B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    entityAId = entA.id;
    entityBId = entB.id;
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

    adminToken = await login(adminEmail);
    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  describe('agreements', () => {
    it('requires authentication (401)', async () => {
      await request(server).get('/api/v1/feeds/agreements').expect(401);
    });

    it('will not let an operator create one (403)', async () => {
      await request(server)
        .post('/api/v1/feeds/agreements')
        .set(auth(opAToken))
        .send({
          entityId: entityAId,
          reference: references[0],
          title: 'Nope',
          startsAt: '2026-01-01',
        })
        .expect(403);
    });

    it('refuses an end date on or before the start (400)', async () => {
      await request(server)
        .post('/api/v1/feeds/agreements')
        .set(auth(adminToken))
        .send({
          entityId: entityAId,
          reference: references[0],
          title: 'Backwards',
          startsAt: '2026-06-01',
          endsAt: '2026-01-01',
        })
        .expect(400);
    });

    it('records a signed agreement', async () => {
      const res = await request(server)
        .post('/api/v1/feeds/agreements')
        .set(auth(adminToken))
        .send({
          entityId: entityAId,
          reference: references[0],
          title: 'Traffic metrics sharing',
          scope: 'Hourly voice and data traffic counters.',
          status: AgreementStatus.ACTIVE,
          signedAt: '2026-01-05',
          startsAt: '2026-01-10',
        })
        .expect(201);
      activeAgreementId = res.body.id;
      expect(res.body.status).toBe(AgreementStatus.ACTIVE);
      expect(res.body.entity.id).toBe(entityAId);
    });

    it('refuses a duplicate reference (400)', async () => {
      await request(server)
        .post('/api/v1/feeds/agreements')
        .set(auth(adminToken))
        .send({
          entityId: entityBId,
          reference: references[0],
          title: 'Same reference',
          startsAt: '2026-01-10',
        })
        .expect(400);
    });

    it('lets an operator see its own agreements and nobody else', async () => {
      const mine = await request(server)
        .get('/api/v1/feeds/agreements')
        .set(auth(opAToken))
        .expect(200);
      expect(mine.body.some((a: { id: string }) => a.id === activeAgreementId)).toBe(true);

      const theirs = await request(server)
        .get('/api/v1/feeds/agreements')
        .set(auth(opBToken))
        .expect(200);
      expect(theirs.body.some((a: { id: string }) => a.id === activeAgreementId)).toBe(false);
    });

    it('records a second agreement that is only a draft', async () => {
      const res = await request(server)
        .post('/api/v1/feeds/agreements')
        .set(auth(adminToken))
        .send({
          entityId: entityBId,
          reference: references[1],
          title: 'Still being negotiated',
          startsAt: '2026-01-10',
        })
        .expect(201);
      draftAgreementId = res.body.id;
      expect(res.body.status).toBe(AgreementStatus.DRAFT);
    });
  });

  describe('the addresses a feed may point at', () => {
    const create = (url: string, expected: number, agreementId?: string) =>
      request(server)
        .post('/api/v1/feeds')
        .set(auth(adminToken))
        .send({
          agreementId: agreementId ?? activeAgreementId,
          name: 'Traffic counters',
          url,
          frequency: FeedFrequency.DAILY,
        })
        .expect(expected);

    it.each([
      ['http://feeds.operator.example/metrics', 'plain http'],
      ['https://user:pass@feeds.operator.example/metrics', 'credentials in the address'],
      ['https://feeds.operator.example:8443/metrics', 'a non-standard port'],
      ['https://127.0.0.1/metrics', 'loopback'],
      ['https://10.0.0.5/metrics', 'a private address'],
      ['https://169.254.169.254/latest/meta-data/', 'the cloud metadata service'],
      ['https://[::1]/metrics', 'IPv6 loopback'],
      ['https://localhost/metrics', 'localhost by name'],
      ['file:///etc/passwd', 'a file URL'],
      ['not a url', 'nonsense'],
    ])('refuses %s (%s)', async (url) => {
      await create(url, 400);
    });

    it('accepts an ordinary public https endpoint', async () => {
      const res = await create('https://feeds.operator.example/metrics', 201);
      expect(res.body.url).toBe('https://feeds.operator.example/metrics');
      expect(res.body.agreement.id).toBe(activeAgreementId);
      // The token an operator issued to NCA is never in a read.
      expect(res.body.authToken).toBeUndefined();
    });

    it('refuses a bad address on an edit too (400)', async () => {
      const list = await request(server).get('/api/v1/feeds').set(auth(adminToken)).expect(200);
      const feed = list.body.find(
        (f: { agreement: { id: string } }) => f.agreement.id === activeAgreementId,
      );
      await request(server)
        .patch(`/api/v1/feeds/${feed.id}`)
        .set(auth(adminToken))
        .send({ url: 'https://169.254.169.254/' })
        .expect(400);
    });
  });

  describe('running a feed', () => {
    let feedId = '';
    let draftFeedId = '';

    beforeAll(async () => {
      const list = await request(server).get('/api/v1/feeds').set(auth(adminToken)).expect(200);
      feedId = list.body.find(
        (f: { agreement: { id: string } }) => f.agreement.id === activeAgreementId,
      ).id;

      const res = await request(server)
        .post('/api/v1/feeds')
        .set(auth(adminToken))
        .send({
          agreementId: draftAgreementId,
          name: 'Not yet agreed',
          url: 'https://feeds.other-operator.example/metrics',
          frequency: FeedFrequency.DAILY,
        })
        .expect(201);
      draftFeedId = res.body.id;
    });

    it('collects nothing while the agreement is only a draft', async () => {
      const res = await request(server)
        .post(`/api/v1/feeds/${draftFeedId}/run`)
        .set(auth(adminToken))
        .expect(201);
      expect(res.body.outcome).toBe('SKIPPED');
      expect(res.body.message).toContain('not in force');
      expect(res.body.metricCount).toBe(0);
    });

    it('collects nothing once an agreement has been terminated', async () => {
      await request(server)
        .patch(`/api/v1/feeds/agreements/${activeAgreementId}`)
        .set(auth(adminToken))
        .send({ status: AgreementStatus.TERMINATED })
        .expect(200);

      const res = await request(server)
        .post(`/api/v1/feeds/${feedId}/run`)
        .set(auth(adminToken))
        .expect(201);
      expect(res.body.outcome).toBe('SKIPPED');

      await request(server)
        .patch(`/api/v1/feeds/agreements/${activeAgreementId}`)
        .set(auth(adminToken))
        .send({ status: AgreementStatus.ACTIVE })
        .expect(200);
    });

    it('records a failure when the endpoint cannot be reached', async () => {
      // The host does not resolve, which is what a real dead endpoint looks like.
      const res = await request(server)
        .post(`/api/v1/feeds/${feedId}/run`)
        .set(auth(adminToken))
        .expect(201);
      expect(res.body.outcome).toBe('FAILED');
      expect(res.body.message).toEqual(expect.any(String));
    });

    it('keeps every attempt, so a silent feed shows as a run of failures', async () => {
      const res = await request(server)
        .get(`/api/v1/feeds/${feedId}/runs`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.runs.length).toBeGreaterThanOrEqual(2);
      expect(res.body.runs[0]).toHaveProperty('outcome');
      expect(res.body.runs[0]).toHaveProperty('startedAt');
    });

    it('stamps the feed with how it last went', async () => {
      const list = await request(server).get('/api/v1/feeds').set(auth(adminToken)).expect(200);
      const feed = list.body.find((f: { id: string }) => f.id === feedId);
      expect(feed.lastRunAt).not.toBeNull();
      expect(feed.lastOutcome).toBe('FAILED');
      expect(feed.lastError).toEqual(expect.any(String));
    });

    it('lets an operator watch its own feed but not run it (403)', async () => {
      await request(server).get(`/api/v1/feeds/${feedId}/runs`).set(auth(opAToken)).expect(200);
      await request(server).post(`/api/v1/feeds/${feedId}/run`).set(auth(opAToken)).expect(403);
    });

    it('will not show one operator another operator feed (404)', async () => {
      await request(server).get(`/api/v1/feeds/${feedId}/runs`).set(auth(opBToken)).expect(404);
    });

    it('reads back what has been collected, scoped to the reader', async () => {
      // Seed a metric directly: the point under test is the read path and its scoping, and driving
      // it through a real outbound fetch would make the suite depend on somebody else's server.
      const run = await prisma.feedRun.findFirst({
        where: { feedId },
        select: { id: true },
        orderBy: { startedAt: 'desc' },
      });
      await prisma.feedMetric.create({
        data: {
          feedRunId: run!.id,
          entityId: entityAId,
          key: 'voice_minutes',
          value: 12345,
          unit: 'minutes',
          measuredAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      });

      const mine = await request(server)
        .get('/api/v1/feeds/metrics')
        .query({ key: 'voice_minutes' })
        .set(auth(opAToken))
        .expect(200);
      expect(mine.body.metrics.some((m: { key: string }) => m.key === 'voice_minutes')).toBe(true);
      expect(mine.body.keys.some((k: { key: string }) => k.key === 'voice_minutes')).toBe(true);

      // The other operator sees none of it.
      const theirs = await request(server)
        .get('/api/v1/feeds/metrics')
        .query({ key: 'voice_minutes' })
        .set(auth(opBToken))
        .expect(200);
      expect(theirs.body.metrics).toEqual([]);

      // And no read anywhere carries the token the operator issued to NCA.
      const feeds = await request(server).get('/api/v1/feeds').set(auth(adminToken)).expect(200);
      expect(JSON.stringify(feeds.body)).not.toContain('authToken');
    });

    it('refuses to remove an agreement that still has feeds (400)', async () => {
      const res = await request(server)
        .delete(`/api/v1/feeds/agreements/${activeAgreementId}`)
        .set(auth(adminToken))
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('still running');
    });

    it('removes the feed, then the agreement', async () => {
      await request(server).delete(`/api/v1/feeds/${feedId}`).set(auth(adminToken)).expect(200);
      await request(server)
        .delete(`/api/v1/feeds/${draftFeedId}`)
        .set(auth(adminToken))
        .expect(200);
      await request(server)
        .delete(`/api/v1/feeds/agreements/${activeAgreementId}`)
        .set(auth(adminToken))
        .expect(200);

      const list = await request(server).get('/api/v1/feeds').set(auth(adminToken)).expect(200);
      expect(list.body.some((f: { id: string }) => f.id === feedId)).toBe(false);
    });
  });
});
