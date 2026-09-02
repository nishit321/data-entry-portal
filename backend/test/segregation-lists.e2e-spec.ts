import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import {
  DocumentKind,
  EntityStatus,
  EntityType,
  NotificationType,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { inventoryRoutes, type RouteFact } from '../src/common/utils/route-inventory.util';

jest.setTimeout(180000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';
const OPERATOR_ROLES: Role[] = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER];

/**
 * The other half of the segregation guarantee: lists.
 *
 * `segregation-sweep.e2e-spec.ts` proves an operator cannot fetch another operator's record **by
 * id**. A leak has a second and commoner shape: a collection endpoint that forgets its scope and
 * quietly hands back everybody's rows. There is no id in that request, so the other sweep never
 * touches it. Thirty collection routes are reachable by an operator.
 *
 * Three kinds, and the difference matters:
 *
 * - **scoped** — must contain the caller's rows and none of anyone else's.
 * - **shared** — the same for every operator by design (a lookup list, the Authority's calendar).
 *   Checked by asserting two different operators get the identical answer, which is a real
 *   assertion rather than a way of skipping one.
 * - **aggregate** — cross-operator *on purpose*, and therefore the sharpest surface in the whole
 *   product. Benchmarking exists to show an operator where it stands against its peers. The only
 *   thing between that and a leak is `MIN_PEERS_FOR_DISCLOSURE`, so these are checked for the
 *   thing that would actually hurt: another operator's name, licence or identifier appearing in
 *   the response at all.
 *
 * As in the by-id sweep, **the route list comes from the running router**: add a collection
 * endpoint an operator can reach and this spec fails until someone says which kind it is.
 */

interface World {
  entityId: string;
  entityName: string;
  licence: string;
  userId: string;
  email: string;
  token: string;
  agentRef: string;
  siteRef: string;
  documentTitle: string;
  clientName: string;
  submissionId: string;
}

type ListKind = 'scoped' | 'shared' | 'aggregate';

interface ListProbe {
  kind: ListKind;
  /** Appended to the path, for endpoints that need a parameter to answer at all. */
  query?: (a: World) => string;
  /**
   * Something of the caller's own that must appear in the answer.
   *
   * The positive control. Without it "B is absent" passes on an empty list, for ever, and the
   * check means nothing — which is how a leak stays hidden behind a green suite.
   */
  mine?: (a: World) => string;
  /** Why there is no positive control, when there cannot be one. Written down, not waved away. */
  noControl?: string;
  /** Turns a non-JSON body into searchable text (the exports). */
  asText?: (body: Buffer) => Promise<string>;
}

/** Reads an xlsx export back with the same library that wrote it. */
async function xlsxText(body: Buffer): Promise<string> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(body as unknown as ArrayBuffer);
  const out: string[] = [];
  book.eachSheet((sheet) => {
    out.push(sheet.name);
    sheet.eachRow((row) => {
      row.eachCell((cell) => out.push(String(cell.value ?? '')));
    });
  });
  return out.join('\n');
}

describe('data segregation, swept across every list an operator can fetch (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;
  let routes: RouteFact[];

  let A: World;
  let B: World;
  let period: { id: string; templateId: string; fieldId: string };

  const LICENCES = ['LIST/A', 'LIST/B'];
  const EMAILS = ['list-a@x.test', 'list-b@x.test'];

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const verified = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    expect(verified.body.accessToken).toBeDefined();
    return verified.body.accessToken as string;
  }

  async function cleanup() {
    const entities = await prisma.entity.findMany({
      where: { licenceNumber: { in: LICENCES } },
      select: { id: true },
    });
    const ids = entities.map((e) => e.id);
    if (ids.length) {
      await prisma.submission.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.documentRecord.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.networkSite.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.apiClient.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.agent.deleteMany({ where: { entityId: { in: ids } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: LICENCES } } });
    await prisma.reportingPeriod.deleteMany({ where: { label: { startsWith: 'Lists ' } } });
    await prisma.reportingTemplate.deleteMany({
      where: { name: { startsWith: 'Lists Template ' } },
    });
  }

  async function buildPeriod() {
    const template = await prisma.reportingTemplate.create({
      data: {
        name: `Lists Template ${Date.now()}`,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: [
            {
              key: 'general',
              title: 'General',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'QUARTERLY_AND_ANNUAL',
              fields: {
                create: [
                  {
                    key: 'subs',
                    label: 'Subscribers',
                    order: 1,
                    dataType: 'INTEGER',
                    isMandatory: true,
                    flowOrStock: 'STOCK',
                  },
                ],
              },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    const created = await prisma.reportingPeriod.create({
      data: {
        templateId: template.id,
        frequency: 'QUARTERLY',
        label: `Lists ${Date.now()}`,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    return {
      id: created.id,
      templateId: template.id,
      fieldId: template.sections[0]!.fields[0]!.id,
    };
  }

  /** An operator with one of everything, and a return with a real figure in it. */
  async function build(tag: string, licence: string, email: string): Promise<World> {
    const entityName = `List ${tag} Telecom`;
    const entity = await prisma.entity.create({
      data: {
        name: entityName,
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        firstName: 'List',
        lastName: tag,
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });

    const agentRef = `AG-LIST-${tag}`;
    await prisma.agent.create({
      data: { entityId: entity.id, agentReference: agentRef, name: `Agent List ${tag}` },
    });

    const siteRef = `SITE-LIST-${tag}`;
    await prisma.networkSite.create({
      data: {
        entityId: entity.id,
        siteReference: siteRef,
        name: `Site List ${tag}`,
        latitude: 4.85,
        longitude: 31.58,
      },
    });

    const documentTitle = `Licence List ${tag}`;
    await prisma.documentRecord.create({
      data: {
        entityId: entity.id,
        kind: DocumentKind.LICENCE,
        title: documentTitle,
        fileName: `list-${tag}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 4,
        storageKey: `lists/${tag}.pdf`,
        uploadedById: user.id,
      },
    });

    await prisma.notification.create({
      data: {
        recipientId: user.id,
        type: NotificationType.RETURN_APPROVED,
        title: `Notice for List ${tag}`,
        body: 'Body',
      },
    });

    const submission = await prisma.submission.create({
      data: {
        entityId: entity.id,
        periodId: period.id,
        templateId: period.templateId,
        createdById: user.id,
      },
    });

    const token = await login(email);

    const clientName = `Client List ${tag}`;
    const client = await request(server)
      .post('/api/v1/api-clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: clientName, scopes: ['READ_PERIODS'] });
    expect(client.status).toBe(201);

    // A real figure, so the analytics and benchmarking endpoints have something to work from.
    const filled = await request(server)
      .put(`/api/v1/submissions/${submission.id}/values`)
      .set('Authorization', `Bearer ${token}`)
      .send({ values: [{ fieldId: period.fieldId, valueText: tag === 'A' ? '1000' : '9999' }] });
    expect(filled.status).toBe(200);

    /*
     * Approve it, in the database rather than through the workflow.
     *
     * Benchmarking counts approved returns only. Without this the peer group is empty, and the
     * disclosure test below would pass because there was nothing to disclose rather than because
     * the threshold held. That is the failure mode this whole suite exists to avoid, so the
     * shortcut is the honest choice: the workflow has its own spec, and what is being tested here
     * is what the figures do once they exist.
     */
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: SubmissionStatus.APPROVED,
        submittedAt: new Date(),
        signedName: `List ${tag}`,
        signedAt: new Date(),
        signedByUserId: user.id,
      },
    });

    return {
      entityId: entity.id,
      entityName,
      licence,
      userId: user.id,
      email,
      token,
      agentRef,
      siteRef,
      documentTitle,
      clientName,
      submissionId: submission.id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    routes = inventoryRoutes(app);

    await cleanup();
    period = await buildPeriod();
    A = await build('A', LICENCES[0]!, EMAILS[0]!);
    B = await build('B', LICENCES[1]!, EMAILS[1]!);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const PROBES: Record<string, ListProbe> = {
    'GET /api/v1/agents': { kind: 'scoped', mine: (a) => a.agentRef },
    'GET /api/v1/geo/sites': { kind: 'scoped', mine: (a) => a.siteRef },
    // The map returns a site's display name, not its reference, so that is what proves A's own
    // sites came back.
    'GET /api/v1/geo/map': { kind: 'scoped', mine: () => 'Site List A' },
    'GET /api/v1/documents': { kind: 'scoped', mine: (a) => a.documentTitle },
    'GET /api/v1/api-clients': { kind: 'scoped', mine: (a) => a.clientName },
    'GET /api/v1/submissions': { kind: 'scoped', mine: (a) => a.submissionId },
    'GET /api/v1/operator/users': { kind: 'scoped', mine: (a) => a.email },
    'GET /api/v1/notifications': { kind: 'scoped', mine: () => 'Notice for List A' },
    'GET /api/v1/entities/me': { kind: 'scoped', mine: (a) => a.licence },
    'GET /api/v1/auth/me': { kind: 'scoped', mine: (a) => a.email },
    'GET /api/v1/auth/phone': {
      kind: 'shared',
      noControl:
        'whether the SMS gateway is configured. A fact about the deployment, identical for ' +
        'everyone, and it names nobody.',
    },
    'GET /api/v1/signatures/certificates': {
      kind: 'scoped',
      noControl:
        "the fixture registers no certificate; the check that matters is that B's never appears.",
    },
    'GET /api/v1/enforcement': {
      kind: 'scoped',
      noControl: 'nothing here is overdue, so neither operator has a case. B must still be absent.',
    },
    'GET /api/v1/levy/assessments': {
      kind: 'scoped',
      noControl:
        'no levy is configured in the fixture; the answer is a shape with no operator in it.',
    },
    'GET /api/v1/feeds': {
      kind: 'scoped',
      noControl: 'a feed needs a sharing agreement, which neither operator has.',
    },
    'GET /api/v1/feeds/agreements': {
      kind: 'scoped',
      noControl: 'the same: no agreement exists for either.',
    },
    'GET /api/v1/feeds/metrics': {
      kind: 'scoped',
      noControl: 'no feed has run, so there are no metrics for either.',
    },
    'GET /api/v1/notifications/unread-count': {
      kind: 'scoped',
      noControl: 'a bare number. It cannot carry a name, and the count itself is scoped.',
    },
    'GET /api/v1/submissions/startable-periods': {
      kind: 'shared',
      noControl: 'the periods open to this operator type. The same list for both.',
    },

    'GET /api/v1/reference-data/categories': { kind: 'shared' },
    'GET /api/v1/reference-data/lookup/:category': {
      kind: 'shared',
      query: () => '',
    },
    'GET /api/v1/reporting-periods': { kind: 'shared' },
    'GET /api/v1/penalty-schedule': { kind: 'shared' },

    'GET /api/v1/analytics/summary': {
      kind: 'aggregate',
      noControl: 'counts only. What matters is that no other operator is named in them.',
    },
    'GET /api/v1/analytics/trends': {
      kind: 'aggregate',
      noControl: 'counts per period, with nobody named.',
    },
    'GET /api/v1/analytics/anomalies': {
      kind: 'aggregate',
      noControl: "an operator sees only its own outliers; B's must not appear.",
    },
    'GET /api/v1/benchmarking/compliance': {
      kind: 'aggregate',
      noControl: 'the point of the endpoint is the peer aggregate. No peer may be named.',
    },
    'GET /api/v1/benchmarking/indicators': {
      kind: 'aggregate',
      noControl: 'the list of indicators available to compare on.',
    },
    'GET /api/v1/benchmarking/indicator': {
      kind: 'aggregate',
      query: () => '?fieldKey=subs',
      noControl: 'the peer figures for one indicator. This is the sharpest one in the product.',
    },

    'GET /api/v1/exports/compliance.xlsx': {
      kind: 'scoped',
      asText: xlsxText,
      noControl: "the workbook is built from the caller's own returns; B must not be in it.",
    },
    'GET /api/v1/exports/levy.xlsx': {
      kind: 'scoped',
      asText: xlsxText,
      noControl: 'no levy is configured, so the sheet is empty of operators.',
    },
    'GET /api/v1/exports/levy.pdf': {
      kind: 'scoped',
      asText: async (body) => body.toString('latin1'),
      noControl: 'the same, as a PDF.',
    },
  };

  function routesUnderTest(): RouteFact[] {
    return routes.filter(
      (r) =>
        r.method === 'GET' &&
        !r.machine &&
        r.access !== 'public' &&
        (r.access === 'any-signed-in' || r.roles.some((role) => OPERATOR_ROLES.includes(role))) &&
        !/:\w+/.test(r.path.replace('/:category', '')),
    );
  }

  it('has an answer for every list an operator can fetch', () => {
    const unanswered = routesUnderTest()
      .map((r) => r.signature)
      .filter((sig) => !(sig in PROBES));

    if (unanswered.length > 0) {
      throw new Error(
        'These collection endpoints are reachable by an operator and nobody has said whether they ' +
          'are scoped, shared, or a deliberate aggregate. Add them to PROBES:\n  ' +
          unanswered.join('\n  '),
      );
    }
  });

  it('probes nothing that no longer exists', () => {
    const live = new Set(routesUnderTest().map((r) => r.signature));
    const stale = Object.keys(PROBES).filter((sig) => !live.has(sig));
    if (stale.length > 0) {
      throw new Error(`These are probed but no longer served:\n  ${stale.join('\n  ')}`);
    }
  });

  /** Everything of B's that must never turn up in an answer given to A. */
  function markersOf(w: World): { label: string; value: string }[] {
    return [
      { label: 'entity id', value: w.entityId },
      { label: 'entity name', value: w.entityName },
      { label: 'licence number', value: w.licence },
      { label: 'agent reference', value: w.agentRef },
      { label: 'site reference', value: w.siteRef },
      { label: 'document title', value: w.documentTitle },
      { label: 'API client name', value: w.clientName },
      { label: 'user email', value: w.email },
      { label: 'submission id', value: w.submissionId },
    ];
  }

  async function fetchAs(world: World, signature: string, probe: ListProbe): Promise<string> {
    const path = signature.split(' ')[1]!.replace('/:category', '/TECHNOLOGY');
    const req = request(server)
      .get(`${path}${probe.query?.(world) ?? ''}`)
      .set('Authorization', `Bearer ${world.token}`);

    if (probe.asText) {
      const res = await req.buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      return probe.asText(res.body as Buffer);
    }

    const res = await req;
    expect(res.status).toBe(200);
    return JSON.stringify(res.body);
  }

  describe('every list', () => {
    const entries = Object.entries(PROBES);

    it.each(entries)('%s keeps the other operator out', async (signature, probe) => {
      const answer = await fetchAs(A, signature, probe);

      // --- The positive control -----------------------------------------------------------------
      if (probe.mine) {
        const marker = probe.mine(A);
        if (!answer.includes(marker)) {
          throw new Error(
            `${signature}: operator A's own data ("${marker}") is not in the answer, so "B is ` +
              `absent" below would pass on an empty list and mean nothing. ` +
              `Answer: ${answer.slice(0, 300)}`,
          );
        }
      }

      // --- The thing actually being asked ---------------------------------------------------------
      for (const marker of markersOf(B)) {
        if (answer.includes(marker.value)) {
          throw new Error(
            `${signature}: operator B's ${marker.label} ("${marker.value}") appears in an answer ` +
              `given to operator A. Answer: ${answer.slice(0, 400)}`,
          );
        }
      }
    });
  });

  describe('shared lists', () => {
    const shared = Object.entries(PROBES).filter(([, p]) => p.kind === 'shared');

    it.each(shared)('%s answers both operators identically', async (signature, probe) => {
      const [forA, forB] = await Promise.all([
        fetchAs(A, signature, probe),
        fetchAs(B, signature, probe),
      ]);
      // A real assertion, not a way of skipping one: if this list ever becomes operator-specific,
      // it stops being shared and needs scoping instead.
      expect(forA).toEqual(forB);
    });
  });

  describe('the disclosure threshold', () => {
    /*
     * The sharpest guarantee in the product, asserted directly rather than inferred.
     *
     * Benchmarking exists to show an operator where it stands against its peers, so cross-operator
     * figures flow through it by design. In this fixture the market is two operators: A is the
     * subject, which leaves exactly one peer. A median of one peer *is* that peer's figure. If the
     * endpoint answered at all, A would be reading B's subscriber count off the screen.
     *
     * `MIN_PEERS_FOR_DISCLOSURE` is what stops that, and this is the check that it still does when
     * wired through a real request rather than called as a function.
     */
    it('withholds every figure when the market is too small to hide anyone in', async () => {
      const res = await request(server)
        .get('/api/v1/benchmarking/indicator?fieldKey=subs')
        .set('Authorization', `Bearer ${A.token}`);

      expect(res.status).toBe(200);
      expect(res.body.summary.withheld).toBe(true);
      expect(res.body.summary.median).toBeNull();
      expect(res.body.summary.mean).toBeNull();
      // No per-operator rows, which is where a name would travel.
      expect(res.body.rows).toEqual([]);

      // And the figure itself. The damaging leak here is a number, not a name: B filed 9,999
      // subscribers, and with one peer in the group a median *is* that number. The marker sweep
      // above searches for names and ids and would never see it.
      expect(JSON.stringify(res.body)).not.toContain('9999');
    });

    it('withholds the compliance metrics on the same grounds', async () => {
      const res = await request(server)
        .get('/api/v1/benchmarking/compliance')
        .set('Authorization', `Bearer ${A.token}`);

      expect(res.status).toBe(200);
      for (const [name, metric] of Object.entries(res.body.metrics as Record<string, unknown>)) {
        const m = metric as { withheld: boolean; median: number | null; mean: number | null };
        expect(`${name}:${m.withheld}`).toBe(`${name}:true`);
        expect(m.median).toBeNull();
        expect(m.mean).toBeNull();
      }
      expect(res.body.rows).toEqual([]);
    });

    it('never offers a minimum or a maximum, which would name the market leader', async () => {
      const res = await request(server)
        .get('/api/v1/benchmarking/indicator?fieldKey=subs')
        .set('Authorization', `Bearer ${A.token}`);

      expect(Object.keys(res.body.summary)).not.toContain('min');
      expect(Object.keys(res.body.summary)).not.toContain('max');
    });
  });

  describe('the detector itself', () => {
    it('finds a marker when one really is there', async () => {
      // The whole spec rests on searching an answer for B's markers. If that search could not find
      // a marker that *is* present, every check above would pass by being blind.
      const answer = await fetchAs(B, 'GET /api/v1/agents', PROBES['GET /api/v1/agents']!);
      expect(answer).toContain(B.agentRef);
    });

    it('reads the text out of an export, rather than seeing an opaque blob', async () => {
      // Same question for the binary bodies. A search of an xlsx that could not see cell text
      // would pronounce every export clean, whatever was inside it.
      const answer = await fetchAs(
        A,
        'GET /api/v1/exports/compliance.xlsx',
        PROBES['GET /api/v1/exports/compliance.xlsx']!,
      );
      expect(answer).toContain('Compliance summary');
      expect(answer).toContain('Returns, total');
    });
  });
});
