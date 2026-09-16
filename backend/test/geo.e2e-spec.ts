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
    // Routes first: they point at sites, and a site cannot go while a route still names it.
    await prisma.fibreLink.deleteMany({
      where: { entity: { licenceNumber: { in: licences } } },
    });
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

  describe('fibre routes (NCA, 15 September 2026)', () => {
    /*
     * "Network Map: Display the complete fiber route."
     *
     * The register keeps points; a route is the line between two of them. Three things are worth
     * holding here, and only one of them is about drawing:
     *
     *  - A route names two sites by id, which is a new way to reach a row. An operator that could
     *    join one of its own nodes to a competitor's would read that competitor's coordinates
     *    straight back off the map, which is the one thing this whole module is scoped to prevent.
     *  - A surveyed route and a straight line look identical on a screen and mean different
     *    things, so the map has to be able to tell them apart.
     *  - The straight line is derived, not stored, so moving a node moves the line.
     */
    const north = { siteReference: 'A-FN-N', name: 'Juba north node', kind: 'FIBRE_NODE' as const };
    const south = { siteReference: 'A-FN-S', name: 'Juba south node', kind: 'FIBRE_NODE' as const };
    let northId: string;
    let southId: string;
    let foreignSiteId: string;

    const createLink = (token: string, body: Record<string, unknown>, expected = 201) =>
      request(server).post('/api/v1/geo/links').set(auth(token)).send(body).expect(expected);

    beforeAll(async () => {
      northId = (await createSite(opAToken, { ...north, latitude: 4.9, longitude: 31.6 })).body
        .id as string;
      southId = (await createSite(opAToken, { ...south, latitude: 4.7, longitude: 31.6 })).body
        .id as string;
      foreignSiteId = (
        await createSite(opBToken, {
          siteReference: 'B-FN-1',
          name: 'Other operator node',
          kind: 'FIBRE_NODE',
          latitude: 5.1,
          longitude: 31.8,
        })
      ).body.id as string;
    });

    it('joins two of an operator own nodes', async () => {
      const created = await createLink(opAToken, {
        linkReference: 'A-LINK-1',
        name: 'Juba metro ring',
        fromSiteId: northId,
        toSiteId: southId,
        lengthKm: 34.5,
        capacityGbps: 100,
      });
      expect(created.body.fromSite.name).toBe(north.name);
      expect(created.body.toSite.name).toBe(south.name);
      // Reported, not derived: the two nodes are about 22 km apart in a straight line, and the
      // cable between them is 34.5 km because it follows the road.
      expect(Number(created.body.lengthKm)).toBe(34.5);
    });

    it('refuses a route that reaches into another operator register (400)', async () => {
      /*
       * The segregation test for this table. Both ids are well-formed and one of them exists, so
       * nothing but an explicit ownership check stops this — and without it the response would
       * hand back the other operator's node name and, through the map, its coordinates.
       */
      const res = await createLink(
        opAToken,
        {
          linkReference: 'A-LINK-X',
          name: 'Reaching across',
          fromSiteId: northId,
          toSiteId: foreignSiteId,
        },
        400,
      );
      expect(res.body.message).toMatch(/own register/i);
    });

    it('refuses a route from a node to itself (400)', async () => {
      await createLink(
        opAToken,
        {
          linkReference: 'A-LINK-LOOP',
          name: 'Nowhere to nowhere',
          fromSiteId: northId,
          toSiteId: northId,
        },
        400,
      );
    });

    it('refuses the same reference twice for one operator (400)', async () => {
      await createLink(
        opAToken,
        {
          linkReference: 'A-LINK-1',
          name: 'Same reference again',
          fromSiteId: northId,
          toSiteId: southId,
        },
        400,
      );
    });

    it('draws a straight line when nobody has surveyed the route', async () => {
      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);

      const route = res.body.routes.find((r: { name: string }) => r.name === 'Juba metro ring');
      expect(route).toBeDefined();
      // Two points, being the two ends, and flagged as not a survey. The flag is what lets the map
      // draw this differently from a route somebody has actually walked.
      expect(route.surveyed).toBe(false);
      expect(route.path).toEqual([
        [4.9, 31.6],
        [4.7, 31.6],
      ]);
    });

    it('moves the straight line when a node moves', async () => {
      // The line is worked out from where the nodes are now, not stored when the route was made.
      // A register where correcting a mast's coordinates left the cable hanging in the old place
      // would be worse than one with no routes at all.
      await request(server)
        .patch(`/api/v1/geo/sites/${southId}`)
        .set(auth(opAToken))
        .send({ latitude: 4.5, longitude: 31.7 })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      const route = res.body.routes.find((r: { name: string }) => r.name === 'Juba metro ring');
      expect(route.path[1]).toEqual([4.5, 31.7]);
    });

    it('draws the surveyed route when the operator supplies one', async () => {
      const list = await request(server)
        .get('/api/v1/geo/links')
        .query({ search: 'A-LINK-1' })
        .set(auth(opAToken))
        .expect(200);
      const id = list.body.data[0].id as string;

      // Three points: the two ends and a bend where the cable follows the road.
      await request(server)
        .patch(`/api/v1/geo/links/${id}`)
        .set(auth(opAToken))
        .send({
          path: [
            [4.9, 31.6],
            [4.8, 31.75],
            [4.5, 31.7],
          ],
        })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      const route = res.body.routes.find((r: { name: string }) => r.name === 'Juba metro ring');
      expect(route.surveyed).toBe(true);
      expect(route.path).toHaveLength(3);
      expect(route.path[1]).toEqual([4.8, 31.75]);
    });

    it('goes back to the straight line when the survey is taken off', async () => {
      const list = await request(server)
        .get('/api/v1/geo/links')
        .query({ search: 'A-LINK-1' })
        .set(auth(opAToken))
        .expect(200);
      const id = list.body.data[0].id as string;

      // An empty array is how a route is cleared. It has to land somewhere distinguishable from
      // "leave it alone", or a bad import could never be undone.
      await request(server)
        .patch(`/api/v1/geo/links/${id}`)
        .set(auth(opAToken))
        .send({ path: [] })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      const route = res.body.routes.find((r: { name: string }) => r.name === 'Juba metro ring');
      expect(route.surveyed).toBe(false);
      expect(route.path).toHaveLength(2);
    });

    it('refuses a route that runs through the middle of the ocean (400)', async () => {
      const res = await createLink(
        opAToken,
        {
          linkReference: 'A-LINK-SEA',
          name: 'Through nowhere',
          fromSiteId: northId,
          toSiteId: southId,
          path: [
            [4.9, 31.6],
            [0, 0],
            [4.5, 31.7],
          ],
        },
        400,
      );
      // Named by position, so somebody with a thousand-point import knows where to look.
      expect(res.body.message).toMatch(/Zero and zero|out at sea/i);
    });

    it('refuses a point that is not a pair of numbers (400)', async () => {
      await createLink(
        opAToken,
        {
          linkReference: 'A-LINK-JUNK',
          name: 'Malformed',
          fromSiteId: northId,
          toSiteId: southId,
          path: [
            [4.9, 31.6],
            ['north', 'a bit east'],
          ],
        },
        400,
      );
    });

    it('shows an operator only its own routes', async () => {
      await createLink(opBToken, {
        linkReference: 'B-LINK-1',
        name: 'Other operator route',
        fromSiteId: foreignSiteId,
        toSiteId: (
          await createSite(opBToken, {
            siteReference: 'B-FN-2',
            name: 'Other operator node two',
            kind: 'FIBRE_NODE',
            latitude: 5.3,
            longitude: 31.9,
          })
        ).body.id,
      });

      const mine = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      const names = (mine.body.routes as { name: string }[]).map((r) => r.name);
      expect(names).toContain('Juba metro ring');
      expect(names).not.toContain('Other operator route');

      // The Authority sees both, which is the point of the sector view.
      const sector = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(adminToken))
        .expect(200);
      const all = (sector.body.routes as { name: string }[]).map((r) => r.name);
      expect(all).toEqual(expect.arrayContaining(['Juba metro ring', 'Other operator route']));
    });

    it('keeps routes on the map when the layer is narrowed to one kind of site', async () => {
      /*
       * A site kind describes a node. A route is not a node, so filtering the map to base stations
       * must not silently drop every fibre run: a reader would conclude the operator has none.
       */
      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ kind: NetworkSiteKind.BASE_STATION, includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      expect(res.body.routes.some((r: { name: string }) => r.name === 'Juba metro ring')).toBe(
        true,
      );
    });

    it('takes a route off the map when it is removed', async () => {
      const list = await request(server)
        .get('/api/v1/geo/links')
        .query({ search: 'A-LINK-1' })
        .set(auth(opAToken))
        .expect(200);
      const id = list.body.data[0].id as string;

      await request(server).delete(`/api/v1/geo/links/${id}`).set(auth(opAToken)).expect(200);

      const res = await request(server)
        .get('/api/v1/geo/map')
        .query({ includeAgents: 'false' })
        .set(auth(opAToken))
        .expect(200);
      expect(res.body.routes.some((r: { name: string }) => r.name === 'Juba metro ring')).toBe(
        false,
      );
    });
  });
});
