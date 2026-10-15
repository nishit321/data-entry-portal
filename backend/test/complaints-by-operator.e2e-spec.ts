import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ComplaintCategory, ComplaintStatus, EntityStatus, EntityType, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(60000);
const OTP = '123456';

/**
 * Complaints per operator (NCA, October 2026: "complaints filtered and grouped per operator, with
 * categories, status, resolution rates and trends").
 *
 * Two audiences, deliberately treated differently. The Authority sees every operator named, with
 * every figure, however small. The public sees nothing per operator until an administrator turns
 * publication on, and even then only operators with enough complaints for a rate to mean anything.
 *
 * The public half is the one with consequences: a name printed beside a complaint count cannot be
 * taken back. So most of what is checked here is what the public is *not* shown.
 */
describe('Complaints by operator (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const RUN = Date.now().toString(36);
  const PASSWORD = 'Passw0rd!23';
  const email = (who: string) => `e2e-cbo-${who}-${RUN}@nca.test`;
  const busyName = `Busy Mobile ${RUN}`;
  const quietName = `Quiet Net ${RUN}`;

  let adminToken: string;
  let analystToken: string;
  let checkerToken: string;
  let operatorToken: string;
  const entityIds: string[] = [];
  const userIds: string[] = [];
  const references: string[] = [];

  async function login(address: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: address, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const v = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return v.body.accessToken as string;
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setPublication(on: boolean) {
    await request(server)
      .patch('/api/v1/settings/public.complaintsByOperator')
      .set(auth(adminToken))
      .send({ value: on })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const busy = await prisma.entity.create({
      data: {
        name: busyName,
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: `E2E/CBO/B/${RUN}`,
      },
    });
    const quiet = await prisma.entity.create({
      data: {
        name: quietName,
        type: EntityType.ISP,
        status: EntityStatus.ACTIVE,
        licenceNumber: `E2E/CBO/Q/${RUN}`,
      },
    });
    entityIds.push(busy.id, quiet.id);

    const passwordHash = await hashPassword(PASSWORD);
    for (const [who, role, entityId] of [
      ['admin', Role.ADMIN, undefined],
      ['analyst', Role.ANALYST, undefined],
      ['checker', Role.CHECKER, undefined],
      ['operator', Role.OPERATOR_ADMIN, busy.id],
    ] as const) {
      const u = await prisma.user.create({
        data: { email: email(who), passwordHash, firstName: who, lastName: 'Cbo', role, entityId },
      });
      userIds.push(u.id);
    }

    /*
     * Twelve about the busy operator, eight of them dealt with in four days; three about the quiet
     * one; two that named nobody. Twelve clears the threshold of ten, three does not.
     */
    const filedAt = new Date(Date.now() - 20 * 86_400_000);
    let n = 0;
    const file = async (aboutEntityId: string | null, ended: boolean) => {
      n += 1;
      const ref = `NCA/CMP/E2E/${RUN}/${n}`;
      references.push(ref);
      await prisma.complaint.create({
        data: {
          referenceNumber: ref,
          trackingCodeHash: `hash-${RUN}-${n}`,
          category: n % 3 === 0 ? ComplaintCategory.COVERAGE : ComplaintCategory.BILLING,
          status: ended ? ComplaintStatus.RESOLVED : ComplaintStatus.RECEIVED,
          subject: 'Probe',
          description: 'A complaint made for the per-operator figures.',
          aboutEntityId,
          createdAt: filedAt,
          resolvedAt: ended ? new Date(filedAt.getTime() + 4 * 86_400_000) : null,
        },
      });
    };
    for (let i = 0; i < 12; i += 1) await file(busy.id, i < 8);
    for (let i = 0; i < 3; i += 1) await file(quiet.id, false);
    for (let i = 0; i < 2; i += 1) await file(null, false);

    adminToken = await login(email('admin'));
    analystToken = await login(email('analyst'));
    checkerToken = await login(email('checker'));
    operatorToken = await login(email('operator'));
  });

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: 'public.complaintsByOperator' } });
    await prisma.complaint.deleteMany({ where: { referenceNumber: { in: references } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await app.close();
  });

  describe("the Authority's view", () => {
    it('is for the people who handle complaints, not for reviewers or operators', async () => {
      await request(server).get('/api/v1/complaints/by-operator').expect(401);
      await request(server)
        .get('/api/v1/complaints/by-operator')
        .set(auth(operatorToken))
        .expect(403);
      await request(server)
        .get('/api/v1/complaints/by-operator')
        .set(auth(checkerToken))
        .expect(403);
      await request(server)
        .get('/api/v1/complaints/by-operator')
        .set(auth(analystToken))
        .expect(200);
    });

    it('names every operator and every figure, however small', async () => {
      const res = await request(server)
        .get('/api/v1/complaints/by-operator')
        .set(auth(adminToken))
        .expect(200);
      type Row = { entity: { name: string }; received: number; resolved: number; open: number };
      const rows = res.body.operators as Row[];
      const busy = rows.find((r) => r.entity.name === busyName)!;
      expect(busy).toMatchObject({ received: 12, resolved: 8, open: 4 });
      // The quiet one too: three is too few to publish, not too few for the Authority to see.
      expect(rows.find((r) => r.entity.name === quietName)).toMatchObject({ received: 3 });
      expect(res.body.unattributed.received).toBeGreaterThanOrEqual(2);
    });

    it('gives the rate, the typical time, the categories and the months', async () => {
      const res = await request(server)
        .get('/api/v1/complaints/by-operator')
        .query({ months: 6 })
        .set(auth(adminToken))
        .expect(200);
      const busy = res.body.operators.find(
        (r: { entity: { name: string } }) => r.entity.name === busyName,
      );
      expect(busy.resolutionRate).toBeCloseTo(8 / 12);
      expect(busy.medianDaysToResolve).toBe(4);
      expect(busy.byCategory[0].category).toBe('BILLING');
      expect(busy.byMonth).toHaveLength(6);
      expect(res.body.months).toHaveLength(6);
    });

    it('refuses a window that is not a window', async () => {
      await request(server)
        .get('/api/v1/complaints/by-operator')
        .query({ months: 0 })
        .set(auth(adminToken))
        .expect(400);
    });
  });

  describe('the public view', () => {
    afterEach(async () => {
      await prisma.systemSetting.deleteMany({ where: { key: 'public.complaintsByOperator' } });
    });

    it('says nothing per operator until the Authority decides to publish', async () => {
      const res = await request(server).get('/api/v1/public/complaints-by-operator').expect(200);
      // Exactly this, and nothing that hints at what would be shown.
      expect(res.body).toEqual({ published: false });
    });

    it('names an operator only once it has enough complaints for a rate to mean anything', async () => {
      await setPublication(true);
      const res = await request(server).get('/api/v1/public/complaints-by-operator').expect(200);
      expect(res.body).toMatchObject({ published: true, windowMonths: 12, threshold: 10 });

      const names = (res.body.operators as { name: string }[]).map((o) => o.name);
      expect(names).toContain(busyName);
      // Three complaints: counted, not named.
      expect(names).not.toContain(quietName);
      expect(res.body.belowThreshold.operators).toBeGreaterThanOrEqual(1);
      expect(res.body.belowThreshold.complaints).toBeGreaterThanOrEqual(3);
    });

    it('publishes only what can be fairly compared, and nothing joinable', async () => {
      await setPublication(true);
      const res = await request(server).get('/api/v1/public/complaints-by-operator').expect(200);
      const busy = res.body.operators.find((o: { name: string }) => o.name === busyName);
      expect(busy).toEqual({
        name: busyName,
        type: 'MNO',
        received: 12,
        resolutionRate: expect.closeTo(8 / 12, 5),
        medianDaysToResolve: 4,
      });
      // No ids anywhere: nothing here should be joinable to anything else.
      expect(JSON.stringify(res.body)).not.toMatch(/"id"|entityId|aboutEntityId/);
    });

    it('goes back to sector totals when publication is turned off', async () => {
      await setPublication(true);
      await setPublication(false);
      const res = await request(server).get('/api/v1/public/complaints-by-operator').expect(200);
      expect(res.body).toEqual({ published: false });
    });
  });
});
