import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  AttachmentKind,
  DocumentKind,
  EntityStatus,
  EntityType,
  NotificationType,
  Role,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { inventoryRoutes, type RouteFact } from '../src/common/utils/route-inventory.util';

jest.setTimeout(120000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';
const OPERATOR_ROLES: Role[] = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER];

/**
 * Can operator A reach operator B's records? Asked of every route that takes an id.
 *
 * This is the heaviest promise the portal makes. Two competitors file commercially sensitive
 * figures into one database, and the only thing between them is that every query is scoped. The
 * existing segregation spec proves it for agents and entities — two resources out of thirty-one
 * controllers — and the rest was assumed.
 *
 * Two things make this a standing guard rather than another spot check:
 *
 * 1. **The route list comes from the running router**, not from a list someone typed. A new
 *    endpoint that takes an id must be answered for here, or this spec fails and says so. That is
 *    the whole point: `RolesGuard` lets any signed-in user through a route with no `@Roles()`, so
 *    forgetting a decorator opens a door silently and nothing else would notice.
 * 2. **Every probe has a positive control.** Asserting that A gets 403 for B's id proves nothing
 *    on its own — a route A could never reach anyway would pass just as well, and pass forever
 *    while the real hole sat elsewhere. So each probe first shows the route works with A's *own*
 *    id, and only then that it refuses B's.
 */

interface World {
  entityId: string;
  userId: string;
  token: string;
  agentId: string;
  submissionId: string;
  attachmentId: string;
  documentId: string;
  apiClientId: string;
  siteId: string;
  notificationId: string;
  certificateId: string;
}

/** What a probe does with one route, and what the two calls should say. */
interface Probe {
  /** Fills `:params` from a world. */
  url: (w: World) => string;
  body?: unknown;
  /**
   * A throwaway A-owned record for the positive control.
   *
   * Anything that writes gets one. The first version of this sweep shared a single fixture, and
   * the `DELETE /submissions/:id` probe cheerfully deleted the submission that four later probes
   * depended on — which then failed for a reason that had nothing to do with segregation. Every
   * probe that mutates now owns what it touches.
   */
  disposable?: (a: World) => Promise<Partial<World>>;
  /** A multipart upload, when the route takes one. Sent as `file`, with any extra form fields. */
  upload?: {
    filename: string;
    contentType: string;
    fields?: Record<string, string>;
    /**
     * The bytes to send. Defaults to a few characters, which is enough for routes that check
     * ownership before they look at the file — and not enough for one that parses first.
     */
    bytes?: (a: World) => Promise<Buffer>;
  };
  /** Codes that count as "A may do this to A's own thing". */
  allow?: number[];
}

/**
 * Routes that take an id but are not entity-owned, with the reason.
 *
 * Each of these was looked at rather than waved through. If one ever becomes entity-scoped, delete
 * its line here and it will immediately demand a probe.
 */
const NOT_ENTITY_SCOPED: Record<string, string> = {
  'GET /api/v1/reference-data/lookup/:category':
    'a shared lookup list (states, technologies). The same for every operator by design.',
  'GET /api/v1/reporting-periods/:id':
    "a reporting period is the Authority's calendar, identical for everyone who must file against it.",
  'GET /api/v1/feeds/:id/runs':
    'a feed hangs off a sharing agreement rather than an entity; its own spec covers agreement scoping.',
};

describe('data segregation, swept across every route that takes an id (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;
  let routes: RouteFact[];

  let A: World;
  let B: World;
  /** Both operators file against the same period, which is how a real quarter works. */
  let period: { id: string; templateId: string };

  const LICENCES = ['SWEEP/A', 'SWEEP/B'];
  const EMAILS = ['sweep-a@x.test', 'sweep-b@x.test'];

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
    await prisma.user.deleteMany({ where: { email: { startsWith: 'sweep-mate-' } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: LICENCES } } });

    // The periods and templates this spec invents, too. The e2e database is shared and specs run
    // in parallel; a spec that leaves rows behind is a spec that breaks somebody else's count
    // three runs later, and the failure lands nowhere near the cause.
    await prisma.reportingPeriod.deleteMany({ where: { label: { startsWith: 'Sweep ' } } });
    await prisma.reportingTemplate.deleteMany({
      where: { name: { startsWith: 'Sweep Template ' } },
    });
  }

  /** A published template and an open period for both operators to file against. */
  async function buildPeriod() {
    const template = await prisma.reportingTemplate.create({
      data: {
        name: `Sweep Template ${Date.now()}`,
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
                  { key: 'op_name', label: 'Name', order: 1, dataType: 'TEXT', isMandatory: true },
                ],
              },
            },
          ],
        },
      },
    });
    const created = await prisma.reportingPeriod.create({
      data: {
        templateId: template.id,
        frequency: 'QUARTERLY',
        label: `Sweep ${Date.now()}`,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        // Far future, so nothing here is ever late and the probes stay about ownership.
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    return { id: created.id, templateId: template.id };
  }

  /** One operator with one of everything, so every probe has something real to point at. */
  async function build(tag: string, licence: string, email: string): Promise<World> {
    const entity = await prisma.entity.create({
      data: {
        name: `Sweep ${tag}`,
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        firstName: 'Sweep',
        lastName: tag,
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });

    const agent = await prisma.agent.create({
      data: { entityId: entity.id, agentReference: `SW-${tag}`, name: `Agent ${tag}` },
    });

    const submission = await prisma.submission.create({
      data: {
        entityId: entity.id,
        periodId: period.id,
        templateId: period.templateId,
        createdById: user.id,
      },
    });
    const attachment = await prisma.submissionAttachment.create({
      data: {
        submissionId: submission.id,
        kind: AttachmentKind.OTHER,
        fileName: `${tag}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 3,
        storageKey: `sweep/${tag}.txt`,
        uploadedById: user.id,
      },
    });
    const document = await prisma.documentRecord.create({
      data: {
        entityId: entity.id,
        kind: DocumentKind.LICENCE,
        title: `Licence ${tag}`,
        fileName: `${tag}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 4,
        storageKey: `sweep/${tag}.pdf`,
        uploadedById: user.id,
      },
    });
    const site = await prisma.networkSite.create({
      data: {
        entityId: entity.id,
        siteReference: `SITE-${tag}`,
        name: `Site ${tag}`,
        latitude: 4.85,
        longitude: 31.58,
      },
    });
    const notification = await prisma.notification.create({
      data: {
        recipientId: user.id,
        type: NotificationType.RETURN_APPROVED,
        title: `Hello ${tag}`,
        body: 'Body',
      },
    });

    const token = await login(email);

    // Through the API, so the credential and its service user are wired the way the app does it.
    const created = await request(server)
      .post('/api/v1/api-clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Client ${tag}`, scopes: ['READ_PERIODS'] });
    expect(created.status).toBe(201);

    const certificate = await prisma.signingCertificate.create({
      data: {
        userId: user.id,
        label: `Cert ${tag}`,
        fingerprint: `sweep-${tag}-${Date.now()}`,
        subject: `CN=${tag}`,
        issuer: `CN=${tag}`,
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
        certificatePem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----',
        algorithm: 'RSA-SHA256',
        notBefore: new Date(Date.now() - 86400000),
        notAfter: new Date(Date.now() + 86400000),
        selfSigned: true,
      },
    });

    return {
      entityId: entity.id,
      userId: user.id,
      token,
      agentId: agent.id,
      submissionId: submission.id,
      attachmentId: attachment.id,
      documentId: document.id,
      apiClientId: created.body.id,
      siteId: site.id,
      notificationId: notification.id,
      certificateId: certificate.id,
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

  // --- Throwaway records, so a probe that writes never damages another probe's fixture ---------
  const freshSubmission = async (a: World): Promise<Partial<World>> => {
    // Its own period, because a return is unique per (entity, period, version). Sharing one
    // period would make the second throwaway collide with the first — which is the database
    // enforcing something true about the domain, not an obstacle to work around.
    const own = await prisma.reportingPeriod.create({
      data: {
        templateId: period.templateId,
        frequency: 'QUARTERLY',
        label: `Sweep ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    const created = await prisma.submission.create({
      data: {
        entityId: a.entityId,
        periodId: own.id,
        templateId: period.templateId,
        createdById: a.userId,
      },
    });
    return { submissionId: created.id };
  };

  const freshAttachment = async (a: World): Promise<Partial<World>> => {
    const { submissionId } = await freshSubmission(a);
    const created = await prisma.submissionAttachment.create({
      data: {
        submissionId: submissionId as string,
        kind: AttachmentKind.OTHER,
        fileName: 'throwaway.txt',
        mimeType: 'text/plain',
        sizeBytes: 3,
        storageKey: `sweep/throwaway-${Date.now()}.txt`,
        uploadedById: a.userId,
      },
    });
    return { submissionId, attachmentId: created.id };
  };

  const freshAgent = async (a: World): Promise<Partial<World>> => ({
    agentId: (
      await prisma.agent.create({
        data: {
          entityId: a.entityId,
          agentReference: `SW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: 'Throwaway',
        },
      })
    ).id,
  });

  const freshSite = async (a: World): Promise<Partial<World>> => ({
    siteId: (
      await prisma.networkSite.create({
        data: {
          entityId: a.entityId,
          siteReference: `SITE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: 'Throwaway',
          latitude: 4.85,
          longitude: 31.58,
        },
      })
    ).id,
  });

  const freshDocument = async (a: World): Promise<Partial<World>> => ({
    documentId: (
      await prisma.documentRecord.create({
        data: {
          entityId: a.entityId,
          kind: DocumentKind.LICENCE,
          title: 'Throwaway',
          fileName: 'throwaway.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4,
          storageKey: `sweep/throwaway-${Date.now()}.pdf`,
          uploadedById: a.userId,
        },
      })
    ).id,
  });

  const freshNotification = async (a: World): Promise<Partial<World>> => ({
    notificationId: (
      await prisma.notification.create({
        data: {
          recipientId: a.userId,
          type: NotificationType.RETURN_APPROVED,
          title: 'Throwaway',
          body: 'Body',
        },
      })
    ).id,
  });

  const freshCertificate = async (a: World): Promise<Partial<World>> => ({
    certificateId: (
      await prisma.signingCertificate.create({
        data: {
          userId: a.userId,
          label: 'Throwaway',
          fingerprint: `sweep-throwaway-${Date.now()}-${Math.random()}`,
          subject: 'CN=Throwaway',
          issuer: 'CN=Throwaway',
          publicKeyPem: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
          certificatePem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----',
          algorithm: 'RSA-SHA256',
          notBefore: new Date(Date.now() - 86400000),
          notAfter: new Date(Date.now() + 86400000),
          selfSigned: true,
        },
      })
    ).id,
  });

  const freshTeammate = async (a: World): Promise<Partial<World>> => ({
    userId: (
      await prisma.user.create({
        data: {
          email: `sweep-mate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.test`,
          passwordHash: await hashPassword(PASSWORD),
          firstName: 'Throwaway',
          lastName: 'Mate',
          role: Role.OPERATOR_SUBMITTER,
          entityId: a.entityId,
        },
      })
    ).id,
  });

  const freshApiClient = async (a: World): Promise<Partial<World>> => {
    const created = await request(server)
      .post('/api/v1/api-clients')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: `Throwaway ${Date.now()}`, scopes: ['READ_PERIODS'] });
    expect(created.status).toBe(201);
    return { apiClientId: created.body.id };
  };

  /** Every probe, keyed by the route signature the inventory reports. */
  const PROBES: Record<string, Probe> = {
    'GET /api/v1/agents/:id': { url: (w) => `/api/v1/agents/${w.agentId}` },
    'PATCH /api/v1/agents/:id': {
      url: (w) => `/api/v1/agents/${w.agentId}`,
      body: { name: 'Renamed' },
      disposable: freshAgent,
    },
    'DELETE /api/v1/agents/:id': {
      url: (w) => `/api/v1/agents/${w.agentId}`,
      disposable: freshAgent,
    },

    'GET /api/v1/submissions/:id': { url: (w) => `/api/v1/submissions/${w.submissionId}` },
    'PUT /api/v1/submissions/:id/values': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/values`,
      body: { values: [] },
      disposable: freshSubmission,
    },
    'POST /api/v1/submissions/:id/validate': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/validate`,
      body: {},
      disposable: freshSubmission,
    },
    'POST /api/v1/submissions/:id/submit': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/submit`,
      body: { signedName: 'Someone Else' },
      disposable: freshSubmission,
      // A's own draft is incomplete, so it is refused for being incomplete. That is a different
      // refusal from "not yours", and either way the route reached the right record.
      allow: [201, 400, 409, 422],
    },
    'POST /api/v1/submissions/:id/revise': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/revise`,
      body: {},
      disposable: freshSubmission,
      // A draft has nothing to revise; again, a refusal about state rather than ownership.
      allow: [201, 400, 409, 422],
    },
    'GET /api/v1/submissions/:id/workbook': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/workbook`,
    },
    'POST /api/v1/submissions/:id/workbook': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/workbook`,
      disposable: freshSubmission,
      // A real file, so the request gets past body validation and actually reaches the ownership
      // check. Without one both calls stop at "no file was uploaded", which proves nothing.
      upload: {
        filename: 'workbook.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // A **real** workbook, downloaded from A's own return. This is the only version of the
        // test that answers the question: rubbish bytes are rejected before ownership is ever
        // considered, so a 400 would have said nothing about whether B's return was safe. Both
        // returns use the same template, so these values would genuinely apply if the server let
        // them.
        bytes: async (a) => {
          // Answer a question first, so the sheet that comes back has something in it. An empty
          // workbook is rejected before ownership is looked at, and a probe that never reaches
          // the check it exists for is decoration.
          const field = await prisma.templateField.findFirstOrThrow({
            where: { section: { templateId: period.templateId } },
            select: { id: true },
          });
          const filled = await request(server)
            .put(`/api/v1/submissions/${a.submissionId}/values`)
            .set('Authorization', `Bearer ${a.token}`)
            .send({ values: [{ fieldId: field.id, valueText: 'Sweep Telecom' }] });
          expect(filled.status).toBe(200);

          const res = await request(server)
            .get(`/api/v1/submissions/${a.submissionId}/workbook`)
            .set('Authorization', `Bearer ${a.token}`)
            .buffer(true)
            .parse((r, cb) => {
              const chunks: Buffer[] = [];
              r.on('data', (c: Buffer) => chunks.push(c));
              r.on('end', () => cb(null, Buffer.concat(chunks)));
            });
          expect(res.status).toBe(200);
          return res.body as Buffer;
        },
      },
      allow: [200, 201],
    },
    'GET /api/v1/submissions/:id/attachments': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/attachments`,
    },
    'POST /api/v1/submissions/:id/attachments': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/attachments`,
      disposable: freshSubmission,
      // `.txt` is not an accepted supporting-document type, and a probe rejected on file type
      // never reaches the ownership check it exists to test.
      upload: { filename: 'note.csv', contentType: 'text/csv', fields: { kind: 'OTHER' } },
      allow: [200, 201],
    },
    'GET /api/v1/submissions/:id/attachments/:attachmentId/download': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/attachments/${w.attachmentId}/download`,
      // The blob is not on disk in a fixture, so a 404 from storage is honest; 403 would not be.
      allow: [200, 404],
    },
    'DELETE /api/v1/submissions/:id/attachments/:attachmentId': {
      url: (w) => `/api/v1/submissions/${w.submissionId}/attachments/${w.attachmentId}`,
      disposable: freshAttachment,
      allow: [200, 204],
    },
    'DELETE /api/v1/submissions/:id': {
      url: (w) => `/api/v1/submissions/${w.submissionId}`,
      disposable: freshSubmission,
      allow: [200, 204],
    },

    'GET /api/v1/documents/:id/download': {
      url: (w) => `/api/v1/documents/${w.documentId}/download`,
      allow: [200, 404],
    },
    'DELETE /api/v1/documents/:id': {
      url: (w) => `/api/v1/documents/${w.documentId}`,
      disposable: freshDocument,
      allow: [200, 204],
    },

    'PATCH /api/v1/api-clients/:id': {
      url: (w) => `/api/v1/api-clients/${w.apiClientId}`,
      body: { name: 'Renamed' },
      disposable: freshApiClient,
    },
    'POST /api/v1/api-clients/:id/rotate': {
      url: (w) => `/api/v1/api-clients/${w.apiClientId}/rotate`,
      body: {},
      disposable: freshApiClient,
      allow: [200, 201],
    },
    'DELETE /api/v1/api-clients/:id': {
      url: (w) => `/api/v1/api-clients/${w.apiClientId}`,
      disposable: freshApiClient,
      allow: [200, 204],
    },

    'PATCH /api/v1/geo/sites/:id': {
      url: (w) => `/api/v1/geo/sites/${w.siteId}`,
      body: { name: 'Renamed' },
      disposable: freshSite,
    },
    'DELETE /api/v1/geo/sites/:id': {
      url: (w) => `/api/v1/geo/sites/${w.siteId}`,
      disposable: freshSite,
      allow: [200, 204],
    },

    'GET /api/v1/operator/users/:id': { url: (w) => `/api/v1/operator/users/${w.userId}` },
    'PATCH /api/v1/operator/users/:id': {
      url: (w) => `/api/v1/operator/users/${w.userId}`,
      body: { firstName: 'Renamed' },
      disposable: freshTeammate,
    },
    'DELETE /api/v1/operator/users/:id': {
      url: (w) => `/api/v1/operator/users/${w.userId}`,
      disposable: freshTeammate,
      allow: [200, 204],
    },

    'PATCH /api/v1/notifications/:id/read': {
      url: (w) => `/api/v1/notifications/${w.notificationId}/read`,
      body: {},
      disposable: freshNotification,
    },

    'GET /api/v1/signatures/returns/:id/digest': {
      url: (w) => `/api/v1/signatures/returns/${w.submissionId}/digest`,
    },
    'GET /api/v1/signatures/returns/:id/verify': {
      url: (w) => `/api/v1/signatures/returns/${w.submissionId}/verify`,
    },
    'DELETE /api/v1/signatures/certificates/:id': {
      url: (w) => `/api/v1/signatures/certificates/${w.certificateId}`,
      disposable: freshCertificate,
      allow: [200, 204],
    },
  };

  /** The routes this spec is responsible for: reachable by an operator, and taking an id. */
  function routesUnderTest(): RouteFact[] {
    return routes.filter(
      (r) =>
        !r.machine &&
        r.access !== 'public' &&
        (r.access === 'any-signed-in' || r.roles.some((role) => OPERATOR_ROLES.includes(role))) &&
        /:\w+/.test(r.path),
    );
  }

  it('has an answer for every route that takes an id', () => {
    const unanswered = routesUnderTest()
      .map((r) => r.signature)
      .filter((sig) => !(sig in PROBES) && !(sig in NOT_ENTITY_SCOPED));

    if (unanswered.length > 0) {
      throw new Error(
        'These routes take an id and nobody has said what happens when the id belongs to ' +
          'another operator. Add a probe to PROBES, or a reason to NOT_ENTITY_SCOPED:\n  ' +
          unanswered.join('\n  '),
      );
    }
  });

  it('probes nothing that no longer exists', () => {
    const live = new Set(routesUnderTest().map((r) => r.signature));
    const stale = [...Object.keys(PROBES), ...Object.keys(NOT_ENTITY_SCOPED)].filter(
      (sig) => !live.has(sig),
    );

    if (stale.length > 0) {
      throw new Error(`These are probed but no longer served:\n  ${stale.join('\n  ')}`);
    }
  });

  describe('every probe', () => {
    const entries = Object.entries(PROBES);

    it.each(entries)(
      '%s refuses another operator, and allows its own',
      async (signature, probe) => {
        const [method, ...rest] = signature.split(' ');
        const verb = method!.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        void rest;

        // The same bytes go to both calls, so the only difference between them is the id.
        const bytes = probe.upload?.bytes ? await probe.upload.bytes(A) : Buffer.from('sweep');

        /** Builds the request, so A's call and B's call are identical but for the id. */
        const call = (world: World) => {
          const req = request(server)
            [verb](probe.url(world))
            .set('Authorization', `Bearer ${A.token}`);
          if (probe.upload) {
            for (const [field, value] of Object.entries(probe.upload.fields ?? {})) {
              req.field(field, value);
            }
            return req.attach('file', bytes, {
              filename: probe.upload.filename,
              contentType: probe.upload.contentType,
            });
          }
          if (probe.body !== undefined) req.send(probe.body as object);
          return req;
        };

        // --- The positive control ---------------------------------------------------------------
        // Without this a route A could never reach would "pass" the check below forever.
        const ownWorld: World = probe.disposable ? { ...A, ...(await probe.disposable(A)) } : A;

        const ownRes = await call(ownWorld);

        const allowed = probe.allow ?? [200, 201, 204];
        if (!allowed.includes(ownRes.status)) {
          throw new Error(
            `${signature}: operator A could not reach its OWN record (${ownRes.status}). ` +
              `The refusal below would then prove nothing, which is exactly how a check like this ` +
              `rots into decoration. Body: ${JSON.stringify(ownRes.body).slice(0, 300)}`,
          );
        }

        // --- The thing actually being asked -------------------------------------------------------
        const otherRes = await call(B);

        if (![403, 404].includes(otherRes.status)) {
          throw new Error(
            `${signature}: operator A reached operator B's record and got ${otherRes.status}. ` +
              `Body: ${JSON.stringify(otherRes.body).slice(0, 300)}`,
          );
        }
      },
    );
  });
});
