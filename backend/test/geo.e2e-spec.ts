import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, NetworkSiteKind, NetworkSiteStatus, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(45000);
const OTP = '123456';

/**
 * The network site register and the map drawn from it (Phase 2).
 *
 * The rule that matters most here is segregation: a mast register is a map of where a competitor
 * has invested, so an operator must never see another operator's points.
 */
describe('Network map (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-geo-admin@nca.test';
  const opAEmail = 'e2e-geo-a@x.test';
  const opBEmail = 'e2e-geo-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/GEO/A', 'E2E/GEO/B'];

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let entityAId: string;
  let entityBId: string;

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
    await prisma.networkSite.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
    await prisma.agent.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
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
        name: 'Geo A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Geo B',
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
          lastName: 'User',
          role: Role.OPERATOR_ADMIN,
          entityId,
        },
      });
    }

    // One mapped agent each, so the map has both layers to draw. Juba is around 4.85N, 31.58E.
    await prisma.agent.create({
      data: {
        entityId: entA.id,
        agentReference: 'GEO-AG-A1',
        name: 'Juba agent',
        latitude: 4.851,
        longitude: 31.582,
      },
    });
    // An agent with no coordinates cannot be drawn and must not appear as a point at (0, 0).
    await prisma.agent.create({
      data: { entityId: entA.id, agentReference: 'GEO-AG-A2', name: 'Unmapped agent' },
    });
    await prisma.agent.create({
      data: {
        entityId: entB.id,
        agentReference: 'GEO-AG-B1',
        name: 'B agent',
        latitude: 4.9,
        longitude: 31.6,
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

  const createSite = (token: string, body: Record<string, unknown>, expected = 201) =>
    request(server).post('/api/v1/geo/sites').set(auth(token)).send(body).expect(expected);

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/geo/map').expect(401);
  });

  describe('the site register', () => {
    it('refuses coordinates that are not on the planet (400)', async () => {
      await createSite(
        opAToken,
        {
          siteReference: 'BAD-1',
          name: 'Off world',
          latitude: 120,
          longitude: 31.5,
        },
        400,
      );
    });

    it('refuses a blank form left at zero and zero (400)', async () => {
      const res = await createSite(
        opAToken,
        {
          siteReference: 'BAD-2',
          name: 'Nowhere',
          latitude: 0,
          longitude: 0,
        },
        400,
      );
      expect(JSON.stringify(res.body)).toContain('out at sea');
    });

    it('adds a site to the operator own register', async () => {
      const res = await createSite(opAToken, {
        siteReference: 'A-BTS-1',
        name: 'Juba central mast',
        kind: NetworkSiteKind.BASE_STATION,
        latitude: 4.859363,
        longitude: 31.571251,
        location: 'Juba',
        technology: '4G',
        coverageM: 3000,
      });
      expect(res.body.entity.id).toBe(entityAId);
      expect(Number(res.body.latitude)).toBeCloseTo(4.859363, 5);
      expect(res.body.coverageM).toBe(3000);
    });

    it('refuses the same reference twice for one operator (400)', async () => {
      await createSite(
        opAToken,
        {
          siteReference: 'A-BTS-1',
          name: 'Duplicate',
          latitude: 4.8,
          longitude: 31.5,
        },
        400,
      );
    });

    it('lets a different operator reuse that reference', async () => {
      await createSite(opBToken, {
        siteReference: 'A-BTS-1',
        name: 'B mast with the same reference',
        kind: NetworkSiteKind.FIBRE_NODE,
        latitude: 7.7,
        longitude: 30.0,
      });
    });

    it('refuses an operator that posts a site onto another register (403)', async () => {
      await createSite(
        opAToken,
        {
          entityId: entityBId,
          siteReference: 'A-BTS-2',
          name: 'Attempted cross-post',
          latitude: 5.1,
          longitude: 31.9,
        },
        403,
      );
    });

    it('accepts an operator naming its own entity', async () => {
      const res = await createSite(opAToken, {
        entityId: entityAId,
        siteReference: 'A-BTS-2',
        name: 'Second mast',
        latitude: 5.1,
        longitude: 31.9,
      });
      expect(res.body.entity.id).toBe(entityAId);
    });

    it('shows an operator only its own sites', async () => {
      const res = await request(server).get('/api/v1/geo/sites').set(auth(opAToken)).expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(
        res.body.data.every((s: { entity: { id: string } }) => s.entity.id === entityAId),
      ).toBe(true);
    });

    it('lets the Authority narrow to one operator', async () => {
      const res = await request(server)
        .get('/api/v1/geo/sites')
        .query({ entityId: entityBId })
        .set(auth(adminToken))
        .expect(200);
      expect(
        res.body.data.every((s: { entity: { id: string } }) => s.entity.id === entityBId),
      ).toBe(true);
    });

    it('will not let one operator edit another operator site', async () => {
      const list = await request(server)
        .get('/api/v1/geo/sites')
        .query({ entityId: entityBId })
        .set(auth(adminToken))
        .expect(200);
      const bSite = list.body.data[0];

      await request(server)
        .patch(`/api/v1/geo/sites/${bSite.id}`)
        .set(auth(opAToken))
        .send({ name: 'Renamed by a competitor' })
        .expect(403);

      await request(server).delete(`/api/v1/geo/sites/${bSite.id}`).set(auth(opAToken)).expect(403);
    });

    it('refuses a half-supplied coordinate on an edit (400)', async () => {
      const list = await request(server).get('/api/v1/geo/sites').set(auth(opAToken)).expect(200);
      await request(server)
        .patch(`/api/v1/geo/sites/${list.body.data[0].id}`)
        .set(auth(opAToken))
        .send({ latitude: 5.5 })
        .expect(400);
    });
  });

  describe('the map', () => {
    it('draws an operator own sites and mapped agents, and nobody else', async () => {
      const res = await request(server).get('/api/v1/geo/map').set(auth(opAToken)).expect(200);

      const entities = new Set(res.body.points.map((p: { entity: { id: string } }) => p.entity.id));
      expect([...entities]).toEqual([entityAId]);

      const names = res.body.points.map((p: { name: string }) => p.name);
      expect(names).toContain('Juba central mast');
      expect(names).toContain('Juba agent');
      // An agent with no coordinates is not a point at (0, 0); it is simply not on the map.
      expect(names).not.toContain('Unmapped agent');
      expect(res.body.counts.agents).toBe(1);
    });

    it('leaves agents off when they are not asked for', async () => {
      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      expect(res.body.counts.agents).toBe(0);
      expect(res.body.points.every((p: { kind: string }) => p.kind !== 'AGENT')).toBe(true);
    });

    it('filters by the kind of site', async () => {
      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ kind: NetworkSiteKind.FIBRE_NODE, includeAgents: 'false', entityId: entityBId })
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.points.every((p: { kind: string }) => p.kind === 'FIBRE_NODE')).toBe(true);
    });

    it('returns coordinates as numbers a map can use directly', async () => {
      const res = await request(server).get('/api/v1/geo/map').set(auth(opAToken)).expect(200);
      const point = res.body.points.find((p: { name: string }) => p.name === 'Juba central mast');
      expect(typeof point.lat).toBe('number');
      expect(typeof point.lng).toBe('number');
      expect(point.lat).toBeCloseTo(4.859363, 5);
    });

    it('gives the Authority every operator points', async () => {
      const res = await request(server).get('/api/v1/geo/map').set(auth(adminToken)).expect(200);
      const entities = new Set(res.body.points.map((p: { entity: { id: string } }) => p.entity.id));
      expect(entities.has(entityAId)).toBe(true);
      expect(entities.has(entityBId)).toBe(true);
    });

    it('reads includeAgents=false as false, not as a non-empty string', async () => {
      // `Boolean('false')` is true, so a query parameter that is not read from the raw request
      // would switch agents on at exactly the moment the caller asked for them to be off.
      const off = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      const on = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'true' })
        .set(auth(opAToken))
        .expect(200);
      expect(off.body.counts.agents).toBe(0);
      expect(on.body.counts.agents).toBe(1);
    });

    it('says when it has shown only part of the picture', async () => {
      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ limit: 1, includeAgents: 'false' })
        .set(auth(adminToken))
        .expect(200);
      expect(res.body.truncated).toBe(true);
      expect(res.body.points).toHaveLength(1);
    });
  });

  it('removes a site and stops mapping it', async () => {
    const list = await request(server).get('/api/v1/geo/sites').set(auth(opAToken)).expect(200);
    const site = list.body.data.find(
      (s: { siteReference: string }) => s.siteReference === 'A-BTS-2',
    );

    await request(server).delete(`/api/v1/geo/sites/${site.id}`).set(auth(opAToken)).expect(200);

    const map = await request(server).get('/api/v1/geo/map').set(auth(opAToken)).expect(200);
    expect(map.body.points.some((p: { id: string }) => p.id === site.id)).toBe(false);
  });

  it('keeps a decommissioned site on the register but marks it', async () => {
    const created = await createSite(opAToken, {
      siteReference: 'A-BTS-OLD',
      name: 'Retired mast',
      status: NetworkSiteStatus.DECOMMISSIONED,
      latitude: 6.2,
      longitude: 30.4,
    });
    expect(created.body.status).toBe(NetworkSiteStatus.DECOMMISSIONED);

    const res = await request(server)
      .get('/api/v1/geo/map')
      .query({ status: NetworkSiteStatus.ACTIVE, includeAgents: 'false' })
      .set(auth(opAToken))
      .expect(200);
    expect(res.body.points.some((p: { name: string }) => p.name === 'Retired mast')).toBe(false);
  });
});
