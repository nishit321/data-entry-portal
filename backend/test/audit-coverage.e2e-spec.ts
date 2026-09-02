import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, ReferenceCategory, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { inventoryRoutes, type RouteFact } from '../src/common/utils/route-inventory.util';

jest.setTimeout(180000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';

/**
 * Does every state change leave a record of who made it?
 *
 * `BACKEND_STANDARDS.md` puts it in the Definition of Done: *"Every state change writes an audit
 * record with a matching AuditAction."* Nothing checked it. For a regulator that is not a small
 * claim — "who changed this figure, and when" is the entire point of an audit trail, and a change
 * that slips through unrecorded leaves a hole nobody notices until somebody asks. At that moment
 * there is no answer, and no way to get one.
 *
 * Two halves, and they do different jobs:
 *
 * 1. **The census** covers all hundred mutating routes. Each is declared as one that must write an
 *    audit record, or one that deliberately does not, with the reason. Add a `POST` and this spec
 *    fails until somebody says which it is. That is the standing guard.
 * 2. **The probes** actually call a route and check the audit table grew. They cover the routes
 *    where an unrecorded change would really damage the record: the regulated data itself, and who
 *    is allowed to touch it. Not all hundred — driving fourteen template-editing endpoints with
 *    valid bodies would be a week of fixtures for a thinner result.
 *
 * **A probe never declares which action it expects.** It reads back what was written. Declaring a
 * hundred `AuditAction` names and verifying twenty of them would put eighty guesses in a file that
 * reads like a specification.
 */

/** Routes that must leave a record. The note says what the record is *for*, not its enum name. */
const MUST_AUDIT: Record<string, string> = {
  // --- The regulated record itself ---
  'POST /api/v1/submissions': 'a return is opened against a period.',
  'PUT /api/v1/submissions/:id/values': 'the figures an operator files.',
  'POST /api/v1/submissions/:id/submit': 'the moment a return becomes a filing.',
  'POST /api/v1/submissions/:id/revise': 'a filed return is reopened.',
  'DELETE /api/v1/submissions/:id': 'a draft is discarded.',
  'POST /api/v1/submissions/:id/workbook': 'answers loaded in bulk from a spreadsheet.',
  'POST /api/v1/submissions/:id/attachments': 'a supporting document is added to a return.',
  'DELETE /api/v1/submissions/:id/attachments/:attachmentId': 'and when one is removed.',
  'POST /api/v1/workflow/:id/decision': 'who approved or rejected a return, which is the decision.',

  // --- Who exists, and what they may do ---
  'POST /api/v1/entities': 'an operator is licensed.',
  'PATCH /api/v1/entities/:id': "an operator's details change.",
  'PATCH /api/v1/entities/:id/status': 'an operator is suspended or restored.',
  'DELETE /api/v1/entities/:id': 'an operator is removed.',
  'POST /api/v1/users': 'an account is created.',
  'PATCH /api/v1/users/:id': 'an account is changed.',
  'PATCH /api/v1/users/:id/role': 'somebody gains or loses privilege. The sharpest of these.',
  'DELETE /api/v1/users/:id': 'an account is removed.',
  'POST /api/v1/operator/users': 'an operator adds someone to its own team.',
  'PATCH /api/v1/operator/users/:id': 'and changes them.',
  'DELETE /api/v1/operator/users/:id': 'and removes them.',

  // --- Machine access, which acts without a person present ---
  'POST /api/v1/api-clients': 'a credential that can file returns unattended is issued.',
  'PATCH /api/v1/api-clients/:id': 'its permissions change.',
  'POST /api/v1/api-clients/:id/rotate': 'its secret is replaced.',
  'DELETE /api/v1/api-clients/:id': 'it is revoked.',
  'POST /api/v1/machine/returns': 'a return opened by a machine, with no person to ask later.',
  'PUT /api/v1/machine/returns/:id/values': 'figures filed by a machine.',
  'POST /api/v1/machine/returns/:id/submit': 'a filing made by a machine.',
  'POST /api/v1/signatures/certificates': 'a signing certificate is registered.',
  'DELETE /api/v1/signatures/certificates/:id': 'and revoked.',

  // --- The rules the Authority sets ---
  'POST /api/v1/templates': 'a questionnaire is created.',
  'PATCH /api/v1/templates/:id': 'and edited.',
  'POST /api/v1/templates/:id/publish': 'a questionnaire becomes the one operators must answer.',
  'POST /api/v1/templates/:id/new-version': 'a new version supersedes it.',
  'DELETE /api/v1/templates/:id': 'a questionnaire is withdrawn.',
  'POST /api/v1/templates/:id/sections': 'a section is added.',
  'PATCH /api/v1/templates/:id/sections/:sectionId': 'and changed.',
  'DELETE /api/v1/templates/:id/sections/:sectionId': 'and removed.',
  'POST /api/v1/templates/:id/sections/:sectionId/fields': 'a question is added.',
  'PATCH /api/v1/templates/:id/sections/:sectionId/fields/:fieldId': 'and changed.',
  'DELETE /api/v1/templates/:id/sections/:sectionId/fields/:fieldId': 'and removed.',
  'POST /api/v1/templates/:id/rules': 'a validation rule is added.',
  'PATCH /api/v1/templates/:id/rules/:ruleId': 'and changed.',
  'DELETE /api/v1/templates/:id/rules/:ruleId': 'and removed.',
  'POST /api/v1/reporting-periods': 'a reporting period is scheduled.',
  'PATCH /api/v1/reporting-periods/:id': 'its dates or deadline change.',
  'POST /api/v1/reporting-periods/:id/open': 'operators may now file against it.',
  'POST /api/v1/reporting-periods/:id/close': 'and may no longer.',
  'DELETE /api/v1/reporting-periods/:id': 'it is withdrawn.',

  // --- Money and consequence ---
  'POST /api/v1/levy/rates': 'the rate operators are charged.',
  'PATCH /api/v1/levy/rates/:id': 'and any change to it.',
  'DELETE /api/v1/levy/rates/:id': 'and its removal.',
  'POST /api/v1/penalty-schedule': 'what non-compliance costs.',
  'PATCH /api/v1/penalty-schedule/:id': 'and any change to it.',
  'DELETE /api/v1/penalty-schedule/:id': 'and its removal.',
  'POST /api/v1/enforcement/sweep': 'compliance cases opened against operators.',
  'POST /api/v1/enforcement/accrue': 'penalties assessed against them.',
  'PATCH /api/v1/enforcement/:id/resolve': 'a case closed.',
  'PATCH /api/v1/enforcement/:id/waive': 'a penalty forgiven. Especially this one.',

  // --- The operator's own records ---
  'POST /api/v1/agents': 'an agent is registered.',
  'PATCH /api/v1/agents/:id': 'and changed.',
  'DELETE /api/v1/agents/:id': 'and removed.',
  'POST /api/v1/geo/sites': 'a network site is registered.',
  'PATCH /api/v1/geo/sites/:id': 'and changed.',
  'DELETE /api/v1/geo/sites/:id': 'and removed.',
  'POST /api/v1/documents': 'a licence or certificate is filed.',
  'DELETE /api/v1/documents/:id': 'and removed.',

  // --- Shared configuration ---
  'POST /api/v1/reference-data': 'a lookup value every operator sees.',
  'PATCH /api/v1/reference-data/:id': 'and any change to it.',
  'DELETE /api/v1/reference-data/:id': 'and its removal.',
  'POST /api/v1/public-indicators': 'what the public portal publishes.',
  'PATCH /api/v1/public-indicators/:id': 'and any change to it.',
  'DELETE /api/v1/public-indicators/:id': 'and its removal.',
  'POST /api/v1/report-schedules': 'a scheduled report and who receives it.',
  'PATCH /api/v1/report-schedules/:id': 'and any change to it.',
  'DELETE /api/v1/report-schedules/:id': 'and its removal.',
  'POST /api/v1/report-schedules/:id/send': 'a report actually sent.',
  'POST /api/v1/feeds': 'an automated data feed from an operator.',
  'PATCH /api/v1/feeds/:id': 'and any change to it.',
  'DELETE /api/v1/feeds/:id': 'and its removal.',
  'POST /api/v1/feeds/:id/run': 'each time it fetches.',
  'POST /api/v1/feeds/agreements': 'the agreement a feed hangs off.',
  'PATCH /api/v1/feeds/agreements/:id': 'and any change to it.',
  'DELETE /api/v1/feeds/agreements/:id': 'and its removal.',

  // --- Identity events ---
  'POST /api/v1/auth/signup': 'an account created from outside.',
  'POST /api/v1/auth/login': 'every attempt, successful or not.',
  'POST /api/v1/auth/verify-otp': 'the second factor cleared.',
  'POST /api/v1/auth/resend-otp': 'another code issued.',
  'POST /api/v1/auth/forgot-password': 'a reset asked for.',
  'POST /api/v1/auth/reset-password': 'a password actually changed.',
  'POST /api/v1/auth/phone': "a code sent to a number, which spends the Authority's credit.",
  'POST /api/v1/auth/phone/verify': "a number confirmed as somebody's.",
  'DELETE /api/v1/auth/phone': 'a number removed.',
  'PATCH /api/v1/complaints/:id/status': 'how a citizen complaint was handled.',
  'POST /api/v1/complaints': 'a citizen complaint arriving.',
};

/**
 * Routes that deliberately write nothing, and why.
 *
 * Each was looked at. The test applied is whether anybody could later need to know that this
 * happened — not whether something changed in the database.
 */
const NOT_AUDITED: Record<string, string> = {
  'PATCH /api/v1/notifications/:id/read':
    'marking your own notification read. Nobody will ever ask who did it, and logging every one ' +
    'would bury the entries that matter.',
  'POST /api/v1/notifications/read-all': 'the same, in bulk.',
  'POST /api/v1/complaints/track':
    'a citizen looking up their own complaint by reference. A read, despite being a POST: the ' +
    'reference goes in the body rather than the URL so it stays out of access logs.',
  'POST /api/v1/submissions/:id/validate':
    'running the checks over a draft. It changes nothing and an operator may do it twenty times ' +
    'while filling a form in. What gets recorded is the submission that follows.',
  'POST /api/v1/scheduler/jobs/:name/run':
    'triggering a background job by hand. Whatever the job then does is audited by the job.',
  'POST /api/v1/documents/sweep-expiries':
    'the same: a sweep that notifies. The notifications it sends are the record.',
};

describe('audit coverage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;
  let routes: RouteFact[];

  const LICENCE = 'AUDIT/A';
  const EMAILS = ['audit-admin@x.test', 'audit-op@x.test'];
  let adminToken: string;
  let opToken: string;
  let adminId: string;
  let opId: string;
  let entityId: string;

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const verified = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return verified.body.accessToken as string;
  }

  async function cleanup() {
    const entities = await prisma.entity.findMany({
      where: { licenceNumber: { startsWith: 'AUDIT/' } },
      select: { id: true },
    });
    const ids = entities.map((e) => e.id);
    if (ids.length) {
      await prisma.submission.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.networkSite.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.apiClient.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.agent.deleteMany({ where: { entityId: { in: ids } } });
    }
    await prisma.user.deleteMany({ where: { email: { startsWith: 'audit-' } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { startsWith: 'AUDIT/' } } });
    await prisma.referenceItem.deleteMany({ where: { code: { startsWith: 'AUDIT_' } } });
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
    const passwordHash = await hashPassword(PASSWORD);
    const entity = await prisma.entity.create({
      data: {
        name: 'Audit Telecom',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: LICENCE,
      },
    });
    entityId = entity.id;
    const admin = await prisma.user.create({
      data: {
        email: EMAILS[0]!,
        passwordHash,
        firstName: 'Audit',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    const op = await prisma.user.create({
      data: {
        email: EMAILS[1]!,
        passwordHash,
        firstName: 'Audit',
        lastName: 'Operator',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    adminId = admin.id;
    opId = op.id;
    adminToken = await login(EMAILS[0]!);
    opToken = await login(EMAILS[1]!);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  function mutating(): RouteFact[] {
    return routes.filter((r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method));
  }

  // --- The census ---------------------------------------------------------------------------

  it('has an answer for every route that changes something', () => {
    const unanswered = mutating()
      .map((r) => r.signature)
      .filter((sig) => !(sig in MUST_AUDIT) && !(sig in NOT_AUDITED));

    if (unanswered.length > 0) {
      throw new Error(
        'These routes change something and nobody has said whether the change is recorded. ' +
          'The Definition of Done says every state change writes an audit record; add each to ' +
          'MUST_AUDIT, or to NOT_AUDITED with a reason:\n  ' +
          unanswered.join('\n  '),
      );
    }
  });

  it('lists nothing that no longer exists', () => {
    const live = new Set(mutating().map((r) => r.signature));
    const stale = [...Object.keys(MUST_AUDIT), ...Object.keys(NOT_AUDITED)].filter(
      (sig) => !live.has(sig),
    );
    if (stale.length > 0) {
      throw new Error(`These are declared but no longer served:\n  ${stale.join('\n  ')}`);
    }
  });

  // --- The probes ---------------------------------------------------------------------------

  /**
   * Call a route and report what it wrote to the audit log.
   *
   * The call has to succeed first. A 400 writes nothing either, and a probe that accepted that as
   * "no audit record" would be reporting a broken request as a missing feature — or worse, a
   * broken request as a pass.
   */
  async function auditFor(
    label: string,
    call: () => request.Test,
    expectStatus: number[] = [200, 201, 204],
  ): Promise<string[]> {
    /*
     * Scoped to this suite's own two actors, and to rows written after this moment.
     *
     * The e2e suites share one database and run four at a time. A bare `count()` would pick up
     * whatever another spec happened to write while this one was mid-request, and the failure
     * would land nowhere near the cause.
     */
    const since = new Date();
    // Postgres timestamps and JS clocks do not agree to the millisecond; a second of slack costs
    // nothing here and removes a race that would otherwise show up once a fortnight.
    since.setSeconds(since.getSeconds() - 1);
    const mine = { actorId: { in: [adminId, opId] }, createdAt: { gte: since } };

    const before = await prisma.auditLog.count({ where: mine });
    const res = await call();
    if (!expectStatus.includes(res.status)) {
      throw new Error(
        `${label}: the call itself failed with ${res.status}, so this proves nothing about ` +
          `auditing. A request that never ran writes no audit record either, and reading that as ` +
          `"not audited" would report a broken fixture as a missing feature. ` +
          `Body: ${JSON.stringify(res.body).slice(0, 300)}`,
      );
    }

    const added = (await prisma.auditLog.count({ where: mine })) - before;
    if (added <= 0) return [];
    const written = await prisma.auditLog.findMany({
      where: mine,
      orderBy: { createdAt: 'desc' },
      take: added,
      select: { action: true },
    });
    return written.map((w) => w.action);
  }

  describe('the routes where an unrecorded change would really matter', () => {
    it('records an operator being licensed, changed, suspended and removed', async () => {
      const created = await request(server)
        .post('/api/v1/entities')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Audit Probe Telecom', type: 'ISP', licenceNumber: 'AUDIT/PROBE' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      expect(
        await auditFor('PATCH /entities/:id', () =>
          request(server)
            .patch(`/api/v1/entities/${id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Audit Probe Renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /entities/:id/status', () =>
          request(server)
            .patch(`/api/v1/entities/${id}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'SUSPENDED' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /entities/:id', () =>
          request(server)
            .delete(`/api/v1/entities/${id}`)
            .set('Authorization', `Bearer ${adminToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records an account being created, changed, given a new role and removed', async () => {
      const created = await request(server)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'audit-probe@x.test',
          firstName: 'Probe',
          lastName: 'User',
          role: Role.ANALYST,
          password: PASSWORD,
        });
      expect(created.status).toBe(201);
      // Creating a user answers with `{ user, temporaryPassword }` rather than the user itself,
      // because the caller needs the password to pass on.
      const id = created.body.user.id as string;
      expect(id).toBeTruthy();

      for (const [label, call] of [
        [
          'PATCH /users/:id',
          () =>
            request(server)
              .patch(`/api/v1/users/${id}`)
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ firstName: 'Renamed' }),
        ],
        [
          'PATCH /users/:id/role',
          () =>
            request(server)
              .patch(`/api/v1/users/${id}/role`)
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ role: Role.SUPERVISOR }),
        ],
        [
          'DELETE /users/:id',
          () =>
            request(server)
              .delete(`/api/v1/users/${id}`)
              .set('Authorization', `Bearer ${adminToken}`),
        ],
      ] as [string, () => request.Test][]) {
        expect(await auditFor(label, call)).not.toHaveLength(0);
      }
    });

    it("records changes to an operator's own register", async () => {
      const agent = await request(server)
        .post('/api/v1/agents')
        .set('Authorization', `Bearer ${opToken}`)
        .send({ agentReference: 'AUDIT-AG-1', name: 'Probe Agent' });
      expect(agent.status).toBe(201);
      const agentId = agent.body.id as string;

      expect(
        await auditFor('PATCH /agents/:id', () =>
          request(server)
            .patch(`/api/v1/agents/${agentId}`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({ name: 'Probe Agent Renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /agents/:id', () =>
          request(server)
            .delete(`/api/v1/agents/${agentId}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);

      const site = await request(server)
        .post('/api/v1/geo/sites')
        .set('Authorization', `Bearer ${opToken}`)
        .send({
          siteReference: 'AUDIT-SITE-1',
          name: 'Probe Site',
          latitude: 4.85,
          longitude: 31.58,
        });
      expect(site.status).toBe(201);

      expect(
        await auditFor('DELETE /geo/sites/:id', () =>
          request(server)
            .delete(`/api/v1/geo/sites/${site.body.id}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records a machine credential being issued, rotated and revoked', async () => {
      // The sharpest of these: a credential that files returns with nobody watching.
      const created = await request(server)
        .post('/api/v1/api-clients')
        .set('Authorization', `Bearer ${opToken}`)
        .send({ name: 'Audit Probe Client', scopes: ['READ_PERIODS'] });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      expect(
        await auditFor('POST /api-clients/:id/rotate', () =>
          request(server)
            .post(`/api/v1/api-clients/${id}/rotate`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({}),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api-clients/:id', () =>
          request(server)
            .delete(`/api/v1/api-clients/${id}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records shared configuration that every operator sees', async () => {
      const created = await request(server)
        .post('/api/v1/reference-data')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ category: ReferenceCategory.TECHNOLOGY, code: 'AUDIT_PROBE', label: 'Probe' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      expect(
        await auditFor('PATCH /reference-data/:id', () =>
          request(server)
            .patch(`/api/v1/reference-data/${id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ label: 'Probe Renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /reference-data/:id', () =>
          request(server)
            .delete(`/api/v1/reference-data/${id}`)
            .set('Authorization', `Bearer ${adminToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records every sign-in attempt, including the ones that fail', async () => {
      // The one an intruder would most like missing.
      expect(
        await auditFor(
          'POST /auth/login (wrong password)',
          () =>
            request(server)
              .post('/api/v1/auth/login')
              .send({ email: EMAILS[0], password: 'not-the-password' }),
          [401],
        ),
      ).not.toHaveLength(0);
    });
  });

  describe('the probe itself', () => {
    it('notices when nothing is written', async () => {
      // Pointed at a route declared as writing nothing. If this came back with entries, the probe
      // would be counting somebody else's rows and every check above would be meaningless.
      const written = await auditFor('POST /notifications/read-all', () =>
        request(server)
          .post('/api/v1/notifications/read-all')
          .set('Authorization', `Bearer ${opToken}`)
          .send({}),
      );
      expect(written).toHaveLength(0);
    });
  });
});
