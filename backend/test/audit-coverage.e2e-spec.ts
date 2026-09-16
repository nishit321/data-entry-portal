import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import ExcelJS from 'exceljs';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditAction, EntityStatus, EntityType, ReferenceCategory, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';
import { hashToken } from '../src/common/utils/token.util';
import { inventoryRoutes, type RouteFact } from '../src/common/utils/route-inventory.util';
import { sign } from '../src/machine-api/request-signing';
import { SMS_PROVIDER, type SmsProvider } from '../src/notifications/sms/sms-provider';

jest.setTimeout(180000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';
/*
 * The authenticator app's side of TOTP.
 *
 * `clone` rather than mutating `authenticator.options`: assigning to it replaces the whole
 * options object and drops the base32 decoder, so every code generated afterwards is wrong. That
 * cost an afternoon once.
 */
const authApp = authenticator.clone({ window: 1 });

/** A code from a neighbouring time step, for a call that cannot reuse the one just spent. */
const nextCode = (secret: string, steps = 1) =>
  authApp.clone({ epoch: Date.now() + steps * 30_000 }).generate(secret);

/**
 * A gateway that keeps the texts instead of sending them.
 *
 * Confirming a phone number needs the six digits that were texted, and there is no other way to
 * learn them: they are random by design, because a code everybody already knows proves nothing
 * about who is holding the handset. So the provider is replaced, not the check.
 */
class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly sent: { to: string; message: string }[] = [];

  isConfigured() {
    return true;
  }

  send(to: string, message: string) {
    this.sent.push({ to, message });
    return Promise.resolve({ providerRef: 'fake-ref', raw: {} });
  }

  /** The code out of the last message, which is the only way a real user gets it either. */
  lastCode(): string {
    return /(\d{6})/.exec(this.sent.at(-1)?.message ?? '')?.[1] ?? '';
  }
}

/** Enough of a PDF and a KML file to get past the upload type checks. */
const PDF = Buffer.from('%PDF-1.7\n%audit probe licence\n1 0 obj');
/** A PNG signature and some padding: enough for the picture a complaint is evidenced with. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
/**
 * A certificate of this suite's own, generated once and pinned here.
 *
 * `SigningCertificate.fingerprint` is globally unique, so borrowing the signatures suite's
 * fixture would collide with it whenever the two run together — which, with four workers on one
 * database, is most runs. Self-signed, valid to 2046, and it signs nothing: registration and
 * revocation are what is being watched.
 */
const PROBE_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDTDCCAjSgAwIBAgIUMdKS/ZKFMArQc50kjmlKTtrQjsAwDQYJKoZIhvcNAQEL
BQAwRjEMMAoGA1UECgwDTkNBMQ4wDAYDVQQLDAVBVURJVDEmMCQGA1UEAwwdTkNB
IFBvcnRhbCBBdWRpdCBQcm9iZSBTaWduZXIwHhcNMjYwOTAzMDgzODQ5WhcNNDYw
ODI5MDgzODQ5WjBGMQwwCgYDVQQKDANOQ0ExDjAMBgNVBAsMBUFVRElUMSYwJAYD
VQQDDB1OQ0EgUG9ydGFsIEF1ZGl0IFByb2JlIFNpZ25lcjCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAPFdpMd2eLQdCtHVgA4Y5WxwTvcfwZ1YW7dKm6Eo
hyY7nq3pr4JgIHK8/kNSA8U2mo1o0gy16r9wdWgkdUrQsNAvcdrNtE2WAFbsIEG3
mE8SY3GSR59O36DDBJINbWpgkIlCNI7D1FU8wgSsQY0GLaOPZW49TO5MZjEomjqL
MzGwp8o9jQ8YCw46jCn+UGHgIDx2vJNpWhRVnWpI/3AvxBIuOnOgG2Hrw4drUcgs
/y8g/TzWYX7Er3CxlQMQWNcNlQ3k8wk7qLN69lnLcvGTQFR1cmi9hG9GaNk2NpKp
Kac99ck4eHHrM3XLjaE+OqklPhISw3VvyAD8zNbZdAu/VUsCAwEAAaMyMDAwHQYD
VR0OBBYEFJCSBDwuDdEeixHMZMBwTgVt6rE4MA8GA1UdEwEB/wQFMAMBAf8wDQYJ
KoZIhvcNAQELBQADggEBAIvqovFNg+XppSoDh/vXPwlQMKEqeNgIXkHke/TXI4i2
F+hJA38g+PP+nKhG6+dxePNKJ22MYBnjXOAA1DfKJWIBE4XcyNTfwxVpAmYd+5WI
OUSxDsfsoCzAHFvughuEKFYxTJx5Mj43KreW0X7GmR4HtcYrt2y+b++smskYgYMU
CtgA8v0nbCRmHsSerWUUDn5ETjG3dqqkVj6O9Jj+DEmY5RFubhdksvqRdHLPAagg
xGIoeML6ogz/pnN8EzocnmtkAsdbekBrdilpGlVRh8OPiWdyw0NYqrvVT3ZgG0kC
NCyM+oEnnusVmEjxymZF3iL6oJMIx1aQr6i0dGtEc/k=
-----END CERTIFICATE-----`;

/** Enough of a KML file to get past the attachment type check. */
const KML = Buffer.from(
  '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>',
);

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
 * 2. **The probes** actually call a route and check the audit table grew. Every route in
 *    `MUST_AUDIT` is probed except two, and those two are named below with the reason.
 *
 *    `PROBED`, near the bottom of this file, is the authoritative list, and two tests hold the
 *    file to it: one fails if a declared route was not actually driven in the run, the other if a
 *    probe's label matches no route in the census. That pairing exists because it was missing.
 *    For a long time every `POST` here was a fixture whose only check was `expect(201)`, while
 *    these notes described the routes as covered — twenty routes measured, sixty described. Both
 *    halves were true on their own, the pair was not, and nothing went red. Prose about coverage
 *    is worth very little; a list something fails against is worth a great deal.
 *
 *    The two exceptions are `POST /enforcement/sweep` and `POST /enforcement/accrue`. See the
 *    note against them: both write a record only when they *change* something, and two other
 *    suites run the same global call against the same database, so a probe there would pass most
 *    of the time and fail for a reason that has nothing to do with auditing.
 *
 * **A probe never declares which action it expects.** It reads back what was written. Declaring a
 * hundred `AuditAction` names would put a hundred guesses in a file that reads like a
 * specification, and the guesses would be checked against the same code that produced them.
 *
 * **What a probe refuses to do** is treat a failed call as a missing record. A request that never
 * ran writes no audit row either, so `probe` throws when the status is not one it was told to
 * expect. Every awkward fixture in this file — a third reporting period for the workbook, a
 * recovery code to remove an authenticator app, a planted password-reset token — exists because
 * that guard turned a broken fixture into a loud failure instead of a quiet false negative.
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
  'POST /api/v1/users/:id/reset-mfa':
    "somebody's second factor removed by an administrator. This is also the shape of an account " +
    'takeover, so the entry names who did it to whom.',
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
  /*
   * These two are census-only on purpose, and it is worth saying why rather than leaving the next
   * person to wonder.
   *
   * Both write an audit record only when they *change* something: the sweep is idempotent per
   * (entity, period), and accrual skips a case whose figure has not moved. Two other suites run
   * the same global calls against the same database, so whichever runs first is the one that
   * writes the record. A probe here would pass most of the time and fail for a reason that has
   * nothing to do with auditing, which is worse than an honest declaration.
   *
   * What is measured instead is what those two produce: `resolve` and `waive` are probed against
   * real cases, and the enforcement fixture proves a case gets opened at all.
   */
  'POST /api/v1/enforcement/sweep': 'compliance cases opened against operators.',
  'POST /api/v1/enforcement/accrue': 'penalties assessed against them.',
  'PATCH /api/v1/enforcement/:id/resolve': 'a case closed.',
  'PATCH /api/v1/enforcement/:id/waive': 'a penalty forgiven. Especially this one.',
  'POST /api/v1/enforcement/:id/orders': 'a licence suspension or cancellation is drafted.',
  'PATCH /api/v1/enforcement/orders/:orderId/approve':
    'and signed off. The sharpest entry in the system: it is the moment an operator loses the ' +
    'right to trade, and the one a court would ask about first.',
  'PATCH /api/v1/enforcement/orders/:orderId/revoke': 'and withdrawn again.',

  // --- The operator's own records ---
  'POST /api/v1/agents': 'an agent is registered.',
  'PATCH /api/v1/agents/:id': 'and changed.',
  'DELETE /api/v1/agents/:id': 'and removed.',
  'POST /api/v1/geo/sites': 'a network site is registered.',
  'PATCH /api/v1/geo/sites/:id': 'and changed.',
  'DELETE /api/v1/geo/sites/:id': 'and removed.',
  'POST /api/v1/geo/links': 'a fibre route is laid between two nodes on the register.',
  'PATCH /api/v1/geo/links/:id': 'and rerouted, which is where the surveyed geometry changes.',
  'DELETE /api/v1/geo/links/:id': 'and removed.',
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
  'POST /api/v1/auth/totp/confirm': 'a second factor switched on.',
  'POST /api/v1/auth/totp/recovery-codes': 'the recovery codes replaced.',
  'DELETE /api/v1/auth/totp': 'a second factor switched off. The one worth noticing.',
  'POST /api/v1/auth/phone': "a code sent to a number, which spends the Authority's credit.",
  'POST /api/v1/auth/phone/verify': "a number confirmed as somebody's.",
  'DELETE /api/v1/auth/phone': 'a number removed.',
  'PATCH /api/v1/complaints/:id/status': 'how a citizen complaint was handled.',
  'POST /api/v1/complaints': 'a citizen complaint arriving.',
  'POST /api/v1/complaints/attachments':
    "a file written to the Authority's storage by somebody with no account. The one write in " +
    'the portal where the audit row is the only record of where the file came from.',
  'DELETE /api/v1/complaints/:id/attachments/:attachmentId':
    'a file taken off a case. Evidence leaving a case file is exactly the act a complainant ' +
    'would later dispute.',
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
  'POST /api/v1/auth/totp':
    'minting a secret that has not been confirmed. Nothing is switched on and nothing is reachable ' +
    'with it; the entry that matters is the confirmation, which is recorded.',
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
  const EMAILS = [
    'audit-admin@x.test',
    'audit-op@x.test',
    'audit-checker@x.test',
    // A second Authority account. An enforcement order cannot be approved by whoever drafted it,
    // so probing the approval needs somebody other than the administrator who drafts it.
    'audit-supervisor@x.test',
  ];
  /** Everything this suite creates is named with this, so cleanup can find it. */
  const PROBE = 'AUDIT PROBE';
  let adminToken: string;
  let opToken: string;
  let checkerToken: string;
  let supervisorToken: string;
  /*
   * Every probe counts only rows written by these three. The e2e suites share one database and
   * run four at a time, so a bare count picks up another spec's work and fails somewhere far
   * from the cause. A route driven by a fourth actor has to be added here or it reads as
   * unaudited.
   */
  let actorIds: string[] = [];
  /** A published questionnaire and an open period, so the returns probes have something to file. */
  let periodId: string;
  /*
   * A second open period, for the machine probe alone.
   *
   * The returns probe leaves its period with a rejected filing and a deleted revision, and a
   * machine opening a draft against that same period would be reading a state this test did not
   * set up. Two periods cost one API call and remove the question.
   */
  let machinePeriodId: string;
  /** This suite's operator, needed by name for a data-sharing agreement. */
  let entityId: string;
  const sms = new FakeSmsProvider();
  let nameFieldId: string;
  let subsFieldId: string;

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
      await prisma.enforcementCase.deleteMany({ where: { entityId: { in: ids } } });
      /*
       * Documents before users, and explicitly.
       *
       * `DELETE /documents/:id` is a soft delete, so the row survives the probe holding
       * `uploadedById`, and that column is `onDelete: Restrict` — deliberately, because a filed
       * licence should not vanish because an account was tidied up. The consequence here is that
       * the user delete below fails outright unless these go first.
       */
      await prisma.documentRecord.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.submission.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.networkSite.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.apiClient.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.agent.deleteMany({ where: { entityId: { in: ids } } });
    }
    // Reset tokens hold their user, so they go first.
    await prisma.passwordResetToken.deleteMany({
      where: { user: { email: { startsWith: 'audit-' } } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'audit-' } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { startsWith: 'AUDIT/' } } });
    await prisma.referenceItem.deleteMany({ where: { code: { startsWith: 'AUDIT_' } } });
    await prisma.complaint.deleteMany({ where: { subject: { startsWith: 'AUDIT PROBE' } } });
    // Feeds before their agreements, and both before the entity that signed them.
    await prisma.networkFeed.deleteMany({ where: { name: { startsWith: 'AUDIT PROBE' } } });
    await prisma.dataSharingAgreement.deleteMany({
      where: { reference: { startsWith: 'AUDIT PROBE' } },
    });
    await prisma.reportSchedule.deleteMany({ where: { name: { startsWith: 'AUDIT PROBE' } } });
    await prisma.publicIndicator.deleteMany({ where: { label: { startsWith: 'AUDIT PROBE' } } });

    /*
     * Periods before templates, and both after the submissions above. A period and a submission
     * hold their template with `onDelete: Restrict`, which is right in production and means the
     * order here is not a matter of taste.
     */
    await prisma.reportingPeriod.deleteMany({ where: { label: { startsWith: 'AUDIT PROBE' } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: { startsWith: 'AUDIT PROBE' } } });
    // The instruments. Matched by label, because a levy rate or penalty rule this suite left
    // behind would still be a rule in force for whoever runs next.
    await prisma.levyRate.deleteMany({ where: { label: { startsWith: 'AUDIT PROBE' } } });
    await prisma.penaltyRule.deleteMany({ where: { label: { startsWith: 'AUDIT PROBE' } } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(sms)
      .compile();
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
        /*
         * VENDOR, and not for realism: no other e2e suite uses it.
         *
         * Benchmarking builds a peer group from every active entity of one type and withholds its
         * figures while too few operators are in it. Once this suite started filing real returns,
         * an MNO here joined somebody else's peer group, pushed it past the disclosure threshold,
         * and made a segregation test fail — in a different file, on a run where nothing in that
         * file had changed. Keep this suite's operator to a type of its own.
         */
        type: EntityType.VENDOR,
        status: EntityStatus.ACTIVE,
        licenceNumber: LICENCE,
      },
    });
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
    const checker = await prisma.user.create({
      data: {
        email: EMAILS[2]!,
        passwordHash,
        firstName: 'Audit',
        lastName: 'Checker',
        role: Role.CHECKER,
      },
    });
    const supervisor = await prisma.user.create({
      data: {
        email: EMAILS[3]!,
        passwordHash,
        firstName: 'Audit',
        lastName: 'Supervisor',
        role: Role.SUPERVISOR,
      },
    });
    actorIds = [admin.id, op.id, checker.id, supervisor.id];
    entityId = entity.id;
    adminToken = await login(EMAILS[0]!);
    opToken = await login(EMAILS[1]!);
    checkerToken = await login(EMAILS[2]!);
    supervisorToken = await login(EMAILS[3]!);

    await buildQuestionnaireAndPeriod();
  });

  /**
   * A published questionnaire with two answerable questions, and a period open against it.
   *
   * Built through the API rather than seeded straight into the tables, because a return that was
   * never opened the way an operator opens one is not evidence about what happens when they do.
   */
  async function buildQuestionnaireAndPeriod() {
    const admin = { Authorization: `Bearer ${adminToken}` };
    const template = await request(server)
      .post('/api/v1/templates')
      .set(admin)
      .send({ name: `${PROBE} returns`, description: 'Fixture for the returns probes' });
    expect(template.status).toBe(201);
    const templateId = template.body.id as string;

    const withSection = await request(server)
      .post(`/api/v1/templates/${templateId}/sections`)
      .set(admin)
      .send({
        key: 'general',
        title: 'General',
        applicableEntityTypes: ['VENDOR'],
        frequency: 'QUARTERLY_AND_ANNUAL',
      });
    expect(withSection.status).toBe(201);
    const sectionId = withSection.body.sections[0].id as string;

    const withName = await request(server)
      .post(`/api/v1/templates/${templateId}/sections/${sectionId}/fields`)
      .set(admin)
      /*
       * Prefixed keys, and not for tidiness.
       *
       * A published indicator is addressed by question *key*, not by template, so it publishes
       * every operator's answer to a question of that name on every published questionnaire.
       * While this suite's indicator existed — a couple of hundred milliseconds, in the middle of
       * its own test — a key of `active` quietly put other suites' figures on the public portal
       * and failed their assertions, in files nobody had touched.
       */
      .send({
        key: 'audit_operator_name',
        label: 'Name of operator',
        dataType: 'TEXT',
        isMandatory: true,
      });
    expect(withName.status).toBe(201);
    const withSubs = await request(server)
      .post(`/api/v1/templates/${templateId}/sections/${sectionId}/fields`)
      .set(admin)
      .send({
        key: 'audit_active',
        label: 'Active subscribers',
        dataType: 'INTEGER',
        isMandatory: true,
      });
    expect(withSubs.status).toBe(201);

    const fields = withSubs.body.sections[0].fields as { key: string; id: string }[];
    nameFieldId = fields.find((f) => f.key === 'audit_operator_name')!.id;
    subsFieldId = fields.find((f) => f.key === 'audit_active')!.id;

    expect(
      (await request(server).post(`/api/v1/templates/${templateId}/publish`).set(admin).send({}))
        .status,
    ).toBe(201);

    const period = await request(server)
      .post('/api/v1/reporting-periods')
      .set(admin)
      .send({
        templateId,
        frequency: 'QUARTERLY',
        label: `${PROBE} 2027 Q1`,
        /*
         * Dated ahead, so this period is never overdue.
         *
         * The returns probe rejects its own filing and deletes the revision, which leaves the
         * operator with nothing filed. Against a past deadline that is exactly the fixture
         * another suite's global compliance sweep opens a case for, and the noise then turns up
         * in a file nobody touched.
         */
        periodStart: '2027-01-01',
        periodEnd: '2027-03-31',
        dueDate: '2027-04-15',
      });
    expect(period.status).toBe(201);
    periodId = period.body.id as string;

    const forMachine = await request(server)
      .post('/api/v1/reporting-periods')
      .set(admin)
      .send({
        templateId,
        frequency: 'QUARTERLY',
        label: `${PROBE} 2027 Q3 machine`,
        periodStart: '2027-07-01',
        periodEnd: '2027-09-30',
        dueDate: '2027-10-15',
      });
    expect(forMachine.status).toBe(201);
    machinePeriodId = forMachine.body.id as string;
  }

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  /**
   * A defaulting operator with two open compliance cases, so `resolve` and `waive` have something
   * real to act on.
   *
   * The operator's type is `OTHER`, which no other suite uses, and the questionnaire applies to
   * that type alone. That matters: the sweep opens a case for every active entity a period's
   * template applies to, so a fixture built on `MNO` would open cases against other suites'
   * operators and change what their own assertions see.
   */
  /** Distinguishes one call's fixtures from another's, since two probes now need cases. */
  let caseFixtureRun = 0;

  async function openTwoCases(): Promise<[string, string]> {
    const admin = { Authorization: `Bearer ${adminToken}` };
    caseFixtureRun += 1;
    const run = caseFixtureRun;

    /*
     * One defaulting operator, reused across calls.
     *
     * The licence number is unique, so a second call cannot create it again — and it should not
     * want to. What each call needs is its own *periods*, because a case is one per (entity,
     * period) and reusing a period would hand back a case another test has already closed.
     */
    const entity = await prisma.entity.upsert({
      where: { licenceNumber: 'AUDIT/DEFAULT' },
      update: {},
      create: {
        name: 'Audit Default Co',
        type: EntityType.OTHER,
        status: EntityStatus.ACTIVE,
        licenceNumber: 'AUDIT/DEFAULT',
      },
    });

    const template = await request(server)
      .post('/api/v1/templates')
      .set(admin)
      .send({
        name: `${PROBE} enforcement ${run}`,
        description: 'Fixture for the case probes',
      });
    expect(template.status).toBe(201);
    const templateId = template.body.id as string;
    const section = await request(server)
      .post(`/api/v1/templates/${templateId}/sections`)
      .set(admin)
      .send({
        key: 'general',
        title: 'General',
        applicableEntityTypes: ['OTHER'],
        frequency: 'QUARTERLY_AND_ANNUAL',
      });
    expect(section.status).toBe(201);
    expect(
      (
        await request(server)
          .post(`/api/v1/templates/${templateId}/sections/${section.body.sections[0].id}/fields`)
          .set(admin)
          .send({ key: 'audit_operator_name', label: 'Name of operator', dataType: 'TEXT' })
      ).status,
    ).toBe(201);
    expect(
      (await request(server).post(`/api/v1/templates/${templateId}/publish`).set(admin).send({}))
        .status,
    ).toBe(201);

    // A rule in force for the periods below, so the cases carry a figure and waiving one means
    // forgiving money rather than closing an empty case.
    expect(
      (
        await request(server)
          .post('/api/v1/penalty-schedule')
          .set(admin)
          .send({
            reason: 'MISSED_DEADLINE',
            entityType: 'OTHER',
            fixedAmount: 5000,
            dailyAmount: 500,
            effectiveFrom: '2025-01-01',
            label: `${PROBE} default rule ${run}`,
          })
      ).status,
    ).toBe(201);

    /*
     * Closed, rather than dated far enough in the past to be overdue. The sweep proceeds once
     * grace has ended *or* the period is closed, and closing it says so outright instead of
     * depending on arithmetic against today's date and a default grace window.
     */
    const periodIds: string[] = [];
    for (const label of ['A', 'B']) {
      const period = await request(server)
        .post('/api/v1/reporting-periods')
        .set(admin)
        .send({
          templateId,
          frequency: 'QUARTERLY',
          label: `${PROBE} default ${run}${label}`,
          periodStart: '2025-01-01',
          periodEnd: '2025-03-31',
          dueDate: '2025-04-15',
        });
      expect(period.status).toBe(201);
      expect(
        (
          await request(server)
            .post(`/api/v1/reporting-periods/${period.body.id}/close`)
            .set(admin)
            .send({})
        ).status,
      ).toBe(201);
      periodIds.push(period.body.id as string);
    }

    await request(server).post('/api/v1/enforcement/sweep').set(admin).send({});

    /*
     * Read the cases back rather than trusting the sweep's own count. Another suite runs the same
     * global sweep, and the sweep is idempotent per (entity, period) — so the call above may
     * legitimately report nothing opened because somebody else opened these a moment earlier.
     * What this fixture needs is that the cases exist, not who created them.
     */
    const listed = await request(server)
      .get('/api/v1/enforcement')
      .query({ entityId: entity.id })
      .set(admin);
    expect(listed.status).toBe(200);
    const ids = (listed.body.data as { id: string; period: { id: string } }[])
      .filter((c) => periodIds.includes(c.period.id))
      .map((c) => c.id);
    if (ids.length < 2) {
      throw new Error(
        `Expected a case for each of this fixture's two closed periods, got ${ids.length}. ` +
          'Without them there is nothing to resolve or waive, and this test would prove nothing ' +
          'about auditing.',
      );
    }
    return [ids[0]!, ids[1]!];
  }

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
  /**
   * Every signature `probe` has actually driven in this run.
   *
   * The coverage check at the end compares this against what the file claims. Without it, a probe
   * that was renamed, skipped or quietly turned into a plain fixture assertion leaves the claim
   * standing and nothing goes red — which is how most of the creates in this file came to be
   * declared as covered while only their `201` was ever checked.
   */
  const probed = new Set<string>();

  async function auditFor(
    label: string,
    call: () => request.Test,
    expectStatus: number[] = [200, 201, 204],
  ): Promise<string[]> {
    return (await probe(label, call, expectStatus)).actions;
  }

  /**
   * As `auditFor`, but hands back the response too, for a create whose id is needed next.
   *
   * `identify` is for a route nobody is signed in to. A citizen filing a complaint has no
   * account, so the row is written with `actorId: null` and the actor-scoped count below cannot
   * see it at all — a probe without this reads a correctly-written record as a missing one. Given
   * the response, `identify` names the exact row instead, which is stricter than counting: it
   * cannot be satisfied by somebody else's row arriving at the same moment.
   */
  async function probe(
    label: string,
    call: () => request.Test,
    expectStatus: number[] = [200, 201, 204],
    identify?: (
      res: request.Response,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<{ actions: string[]; res: request.Response }> {
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
    const mine = { actorId: { in: actorIds }, createdAt: { gte: since } };

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

    probed.add(label);

    if (identify) {
      const rows = await prisma.auditLog.findMany({
        where: { ...(await identify(res)), createdAt: { gte: since } },
        select: { action: true },
      });
      return { actions: rows.map((r) => r.action), res };
    }

    const added = (await prisma.auditLog.count({ where: mine })) - before;
    if (added <= 0) return { actions: [], res };
    const written = await prisma.auditLog.findMany({
      where: mine,
      orderBy: { createdAt: 'desc' },
      take: added,
      select: { action: true },
    });
    return { actions: written.map((w) => w.action), res };
  }

  describe('the routes where an unrecorded change would really matter', () => {
    it('records an operator being licensed, changed, suspended and removed', async () => {
      const created = await probe('POST /api/v1/entities', () =>
        request(server)
          .post('/api/v1/entities')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: 'Audit Probe Telecom', type: 'VENDOR', licenceNumber: 'AUDIT/PROBE' }),
      );
      expect(created.actions).not.toHaveLength(0);
      const id = created.res.body.id as string;

      expect(
        await auditFor('PATCH /api/v1/entities/:id', () =>
          request(server)
            .patch(`/api/v1/entities/${id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'Audit Probe Renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /api/v1/entities/:id/status', () =>
          request(server)
            .patch(`/api/v1/entities/${id}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'SUSPENDED' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/entities/:id', () =>
          request(server)
            .delete(`/api/v1/entities/${id}`)
            .set('Authorization', `Bearer ${adminToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records an account being created, changed, given a new role and removed', async () => {
      const created = await probe('POST /api/v1/users', () =>
        request(server).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({
          email: 'audit-probe@x.test',
          firstName: 'Probe',
          lastName: 'User',
          role: Role.ANALYST,
          password: PASSWORD,
        }),
      );
      expect(created.actions).not.toHaveLength(0);
      // Creating a user answers with `{ user, temporaryPassword }` rather than the user itself,
      // because the caller needs the password to pass on.
      const id = created.res.body.user.id as string;
      expect(id).toBeTruthy();

      for (const [label, call] of [
        [
          'PATCH /api/v1/users/:id',
          () =>
            request(server)
              .patch(`/api/v1/users/${id}`)
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ firstName: 'Renamed' }),
        ],
        [
          'PATCH /api/v1/users/:id/role',
          () =>
            request(server)
              .patch(`/api/v1/users/${id}/role`)
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ role: Role.SUPERVISOR }),
        ],
        [
          'DELETE /api/v1/users/:id',
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
      const agent = await probe('POST /api/v1/agents', () =>
        request(server)
          .post('/api/v1/agents')
          .set('Authorization', `Bearer ${opToken}`)
          .send({ agentReference: 'AUDIT-AG-1', name: 'Probe Agent' }),
      );
      expect(agent.actions).not.toHaveLength(0);
      const agentId = agent.res.body.id as string;

      expect(
        await auditFor('PATCH /api/v1/agents/:id', () =>
          request(server)
            .patch(`/api/v1/agents/${agentId}`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({ name: 'Probe Agent Renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/agents/:id', () =>
          request(server)
            .delete(`/api/v1/agents/${agentId}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);

      const site = await probe('POST /api/v1/geo/sites', () =>
        request(server).post('/api/v1/geo/sites').set('Authorization', `Bearer ${opToken}`).send({
          siteReference: 'AUDIT-SITE-1',
          name: 'Probe Site',
          latitude: 4.85,
          longitude: 31.58,
        }),
      );
      expect(site.actions).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /api/v1/geo/sites/:id', () =>
          request(server)
            .patch(`/api/v1/geo/sites/${site.res.body.id}`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({ name: 'Probe Site Renamed' }),
        ),
      ).not.toHaveLength(0);

      /*
       * A route, before the site it starts from is removed: a route names two sites, so the delete
       * below would take this with it.
       */
      const other = await request(server)
        .post('/api/v1/geo/sites')
        .set('Authorization', `Bearer ${opToken}`)
        .send({
          siteReference: 'AUDIT-SITE-2',
          name: 'Probe Site Two',
          kind: 'FIBRE_NODE',
          latitude: 4.9,
          longitude: 31.6,
        })
        .expect(201);

      const link = await probe('POST /api/v1/geo/links', () =>
        request(server).post('/api/v1/geo/links').set('Authorization', `Bearer ${opToken}`).send({
          linkReference: 'AUDIT-LINK-1',
          name: 'Probe Route',
          fromSiteId: site.res.body.id,
          toSiteId: other.body.id,
        }),
      );
      expect(link.actions).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /api/v1/geo/links/:id', () =>
          request(server)
            .patch(`/api/v1/geo/links/${link.res.body.id}`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({ name: 'Probe Route Rerouted' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/geo/links/:id', () =>
          request(server)
            .delete(`/api/v1/geo/links/${link.res.body.id}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/geo/sites/:id', () =>
          request(server)
            .delete(`/api/v1/geo/sites/${site.res.body.id}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records a machine credential being issued, rotated and revoked', async () => {
      // The sharpest of these: a credential that files returns with nobody watching.
      const created = await probe('POST /api/v1/api-clients', () =>
        request(server)
          .post('/api/v1/api-clients')
          .set('Authorization', `Bearer ${opToken}`)
          .send({ name: 'Audit Probe Client', scopes: ['READ_PERIODS'] }),
      );
      expect(created.actions).not.toHaveLength(0);
      const id = created.res.body.id as string;

      expect(
        await auditFor('PATCH /api/v1/api-clients/:id', () =>
          request(server)
            .patch(`/api/v1/api-clients/${id}`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({ name: 'Audit Probe Client, renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('POST /api/v1/api-clients/:id/rotate', () =>
          request(server)
            .post(`/api/v1/api-clients/${id}/rotate`)
            .set('Authorization', `Bearer ${opToken}`)
            .send({}),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/api-clients/:id', () =>
          request(server)
            .delete(`/api/v1/api-clients/${id}`)
            .set('Authorization', `Bearer ${opToken}`),
        ),
      ).not.toHaveLength(0);
    });

    it('records shared configuration that every operator sees', async () => {
      const created = await probe('POST /api/v1/reference-data', () =>
        request(server)
          .post('/api/v1/reference-data')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ category: ReferenceCategory.TECHNOLOGY, code: 'AUDIT_PROBE', label: 'Probe' }),
      );
      expect(created.actions).not.toHaveLength(0);
      const id = created.res.body.id as string;

      expect(
        await auditFor('PATCH /api/v1/reference-data/:id', () =>
          request(server)
            .patch(`/api/v1/reference-data/${id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ label: 'Probe Renamed' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/reference-data/:id', () =>
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
          'POST /api/v1/auth/login',
          () =>
            request(server)
              .post('/api/v1/auth/login')
              .send({ email: EMAILS[0], password: 'not-the-password' }),
          [401],
        ),
      ).not.toHaveLength(0);
    });

    it('records a return through its whole life, from draft to rejection to revision', async () => {
      // The regulated record itself. If any one of these is unrecorded, "who filed this figure,
      // and who accepted it" has no answer, and that question is the reason the system exists.
      const op = { Authorization: `Bearer ${opToken}` };
      const draft = await probe('POST /api/v1/submissions', () =>
        request(server).post('/api/v1/submissions').set(op).send({ periodId }),
      );
      expect(draft.actions).not.toHaveLength(0);
      const id = draft.res.body.id as string;

      expect(
        await auditFor('PUT /api/v1/submissions/:id/values', () =>
          request(server)
            .put(`/api/v1/submissions/${id}/values`)
            .set(op)
            .send({
              values: [
                { fieldId: nameFieldId, valueText: 'Audit Telecom' },
                { fieldId: subsFieldId, valueText: '4200' },
              ],
            }),
        ),
      ).not.toHaveLength(0);

      const uploaded = await probe('POST /api/v1/submissions/:id/attachments', () =>
        request(server)
          .post(`/api/v1/submissions/${id}/attachments`)
          .set(op)
          .field('kind', 'COVERAGE_MAP')
          .attach('file', KML, 'coverage.kml'),
      );
      expect(uploaded.actions).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/submissions/:id/attachments/:attachmentId', () =>
          request(server)
            .delete(`/api/v1/submissions/${id}/attachments/${uploaded.res.body.id}`)
            .set(op),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('POST /api/v1/submissions/:id/submit', () =>
          request(server)
            .post(`/api/v1/submissions/${id}/submit`)
            .set(op)
            .send({ signedName: 'Audit Operator' }),
        ),
      ).not.toHaveLength(0);

      // The decision is the point of the review, so it is the entry a dispute turns on.
      expect(
        await auditFor('POST /api/v1/workflow/:id/decision', () =>
          request(server)
            .post(`/api/v1/workflow/${id}/decision`)
            .set({ Authorization: `Bearer ${checkerToken}` })
            .send({ decision: 'REJECT', comment: 'Subscriber figure needs checking' }),
        ),
      ).not.toHaveLength(0);

      const revised = await probe('POST /api/v1/submissions/:id/revise', () =>
        request(server).post(`/api/v1/submissions/${id}/revise`).set(op).send({}),
      );
      expect(revised.actions).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/submissions/:id', () =>
          request(server).delete(`/api/v1/submissions/${revised.res.body.id}`).set(op),
        ),
      ).not.toHaveLength(0);
    });

    it('records every edit to a questionnaire, down to a single question', async () => {
      /*
       * All fourteen template-editing routes, in the order somebody actually edits: build it,
       * change it, publish it, supersede it, withdraw the draft that replaced it.
       *
       * These were left unprobed for a long time on the grounds that the fixtures cost more than
       * the result was worth. That was the wrong trade. A questionnaire defines what every
       * operator must answer, so an unrecorded edit changes the obligation itself with nobody
       * named against the change.
       */
      const admin = { Authorization: `Bearer ${adminToken}` };
      const created = await probe('POST /api/v1/templates', () =>
        request(server)
          .post('/api/v1/templates')
          .set(admin)
          .send({ name: `${PROBE} edits`, description: 'Probe' }),
      );
      expect(created.actions).not.toHaveLength(0);
      const id = created.res.body.id as string;

      const withSection = await probe('POST /api/v1/templates/:id/sections', () =>
        request(server)
          .post(`/api/v1/templates/${id}/sections`)
          .set(admin)
          .send({
            key: 'general',
            title: 'General',
            applicableEntityTypes: ['VENDOR'],
            frequency: 'QUARTERLY_AND_ANNUAL',
          }),
      );
      expect(withSection.actions).not.toHaveLength(0);
      const sectionId = withSection.res.body.sections[0].id as string;
      const field = (key: string, label: string, dataType: string) =>
        request(server)
          .post(`/api/v1/templates/${id}/sections/${sectionId}/fields`)
          .set(admin)
          .send({ key, label, dataType });

      expect(
        await auditFor('POST /api/v1/templates/:id/sections/:sectionId/fields', () =>
          field('audit_operator_name', 'Name of operator', 'TEXT'),
        ),
      ).not.toHaveLength(0);
      expect((await field('audit_active', 'Active subscribers', 'INTEGER')).status).toBe(201);
      const third = await field('audit_registered', 'Registered subscribers', 'INTEGER');
      expect(third.status).toBe(201);
      const fields = third.body.sections[0].fields as { key: string; id: string }[];
      const activeId = fields.find((f) => f.key === 'audit_active')!.id;
      const spareId = fields.find((f) => f.key === 'audit_registered')!.id;

      const withRule = await probe('POST /api/v1/templates/:id/rules', () =>
        request(server)
          .post(`/api/v1/templates/${id}/rules`)
          .set(admin)
          .send({
            type: 'LESS_OR_EQUAL',
            severity: 'HARD',
            label: 'active is at most registered',
            config: { left: 'audit_active', right: 'audit_registered' },
          }),
      );
      expect(withRule.actions).not.toHaveLength(0);
      const ruleId = withRule.res.body.rules[0].id as string;

      for (const [label, call] of [
        [
          'PATCH /api/v1/templates/:id/sections/:sectionId/fields/:fieldId',
          () =>
            request(server)
              .patch(`/api/v1/templates/${id}/sections/${sectionId}/fields/${activeId}`)
              .set(admin)
              .send({ label: 'Active subscribers at period end' }),
        ],
        [
          'PATCH /api/v1/templates/:id/rules/:ruleId',
          () =>
            request(server)
              .patch(`/api/v1/templates/${id}/rules/${ruleId}`)
              .set(admin)
              .send({ severity: 'SOFT' }),
        ],
        [
          'DELETE /api/v1/templates/:id/rules/:ruleId',
          () => request(server).delete(`/api/v1/templates/${id}/rules/${ruleId}`).set(admin),
        ],
        [
          'DELETE /api/v1/templates/:id/sections/:sectionId/fields/:fieldId',
          () =>
            request(server)
              .delete(`/api/v1/templates/${id}/sections/${sectionId}/fields/${spareId}`)
              .set(admin),
        ],
        [
          'PATCH /api/v1/templates/:id/sections/:sectionId',
          () =>
            request(server)
              .patch(`/api/v1/templates/${id}/sections/${sectionId}`)
              .set(admin)
              .send({ title: 'General information' }),
        ],
        [
          'PATCH /api/v1/templates/:id',
          () =>
            request(server)
              .patch(`/api/v1/templates/${id}`)
              .set(admin)
              .send({ description: 'Probe, renamed' }),
        ],
        [
          'POST /api/v1/templates/:id/publish',
          () => request(server).post(`/api/v1/templates/${id}/publish`).set(admin).send({}),
        ],
      ] as [string, () => request.Test][]) {
        expect(await auditFor(label, call)).not.toHaveLength(0);
      }

      // Superseding the published questionnaire, then withdrawing the draft that replaced it. The
      // published version stays: it is what operators answered, and it is not ours to delete.
      const v2 = await probe('POST /api/v1/templates/:id/new-version', () =>
        request(server).post(`/api/v1/templates/${id}/new-version`).set(admin).send({}),
      );
      expect(v2.actions).not.toHaveLength(0);
      const v2Id = v2.res.body.id as string;

      expect(
        await auditFor('DELETE /api/v1/templates/:id/sections/:sectionId', () =>
          request(server)
            .delete(`/api/v1/templates/${v2Id}/sections/${v2.res.body.sections[0].id}`)
            .set(admin),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/templates/:id', () =>
          request(server).delete(`/api/v1/templates/${v2Id}`).set(admin),
        ),
      ).not.toHaveLength(0);
    });

    it('records a reporting period being scheduled, opened and closed', async () => {
      // Opening and closing a period decides whether an operator can file at all, and therefore
      // whether they are late. A deadline that moved with nobody's name against it is the kind of
      // thing that gets argued about after a penalty.
      const admin = { Authorization: `Bearer ${adminToken}` };
      const templateId = (
        await request(server).get(`/api/v1/reporting-periods/${periodId}`).set(admin)
      ).body.templateId as string;
      expect(templateId).toBeTruthy();

      const created = await probe('POST /api/v1/reporting-periods', () =>
        request(server)
          .post('/api/v1/reporting-periods')
          .set(admin)
          .send({
            templateId,
            frequency: 'QUARTERLY',
            label: `${PROBE} 2027 Q2`,
            // Ahead of today for the same reason as the fixture above: this probe closes the
            // period partway through, and a closed period in the past is swept.
            periodStart: '2027-04-01',
            periodEnd: '2027-06-30',
            dueDate: '2027-07-15',
            // Scheduled, not open, so opening it is a real transition this probe can watch.
            status: 'SCHEDULED',
          }),
      );
      expect(created.actions).not.toHaveLength(0);
      const id = created.res.body.id as string;

      for (const [label, call] of [
        [
          'PATCH /api/v1/reporting-periods/:id',
          () =>
            request(server)
              .patch(`/api/v1/reporting-periods/${id}`)
              .set(admin)
              .send({ dueDate: '2027-07-31' }),
        ],
        [
          'POST /api/v1/reporting-periods/:id/open',
          () => request(server).post(`/api/v1/reporting-periods/${id}/open`).set(admin).send({}),
        ],
        [
          'POST /api/v1/reporting-periods/:id/close',
          () => request(server).post(`/api/v1/reporting-periods/${id}/close`).set(admin).send({}),
        ],
        [
          'DELETE /api/v1/reporting-periods/:id',
          () => request(server).delete(`/api/v1/reporting-periods/${id}`).set(admin),
        ],
      ] as [string, () => request.Test][]) {
        expect(await auditFor(label, call)).not.toHaveLength(0);
      }
    });

    it('records a licence being suspended, and the order later withdrawn', async () => {
      /*
       * The sharpest routes in the system. `waive` cancels money; this ends an operator's right to
       * trade. NCA required the sign-off to escalate past the officer chain — "DG approves a
       * suspension; the Board approves a cancellation" — which only means anything if who signed,
       * and when, is on the record.
       *
       * Two accounts are needed because an officer may not approve their own draft, and this suite
       * has exactly two Authority actors.
       */
      const admin = { Authorization: `Bearer ${adminToken}` };
      const cases = await openTwoCases();

      const drafted = await probe('POST /api/v1/enforcement/:id/orders', () =>
        request(server).post(`/api/v1/enforcement/${cases[0]}/orders`).set(admin).send({
          type: 'SUSPENSION_PARTIAL',
          reason: 'Quality of service below the licensed threshold for two quarters.',
          legalBasis: 'Section 42(3)',
          effectiveFrom: '2027-01-01',
          durationDays: 90,
        }),
      );
      expect(drafted.actions).not.toHaveLength(0);
      const orderId = drafted.res.body.id as string;

      /*
       * Approved by the supervisor, not the administrator who drafted it.
       *
       * That is the rule under test as much as the audit row: a single account doing both is the
       * officer chain wearing a hat, and it is the first thing anybody reviewing a contested
       * suspension would look for.
       */
      expect(
        await auditFor('PATCH /api/v1/enforcement/orders/:orderId/approve', () =>
          request(server)
            .patch(`/api/v1/enforcement/orders/${orderId}/approve`)
            .set({ Authorization: `Bearer ${supervisorToken}` })
            .send({}),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /api/v1/enforcement/orders/:orderId/revoke', () =>
          request(server)
            .patch(`/api/v1/enforcement/orders/${orderId}/revoke`)
            .set(admin)
            .send({ note: 'Withdrawn: the operator restored service within the notice period.' }),
        ),
      ).not.toHaveLength(0);
    });

    it('records changes to the levy rate and the penalty schedule', async () => {
      /*
       * What operators are charged, and what non-compliance costs them. Both are instruments the
       * Authority sets, and a figure that changed with nobody's name against it is indefensible
       * the first time an operator disputes an assessment.
       *
       * Both fixtures are built so they can never be the rule in force for anybody else. The levy
       * rate takes effect in 2099, and `rateForDate` only considers windows that have started, so
       * it wins for no real period. The penalty rule names `OTHER`, a type no other suite uses,
       * and `ruleFor` filters by type. Neither is realistic, and realism is not what this test is
       * for: a levy rate that quietly became the one in force would change another suite's
       * arithmetic and fail there.
       */
      const admin = { Authorization: `Bearer ${adminToken}` };
      const rate = await probe('POST /api/v1/levy/rates', () =>
        request(server)
          .post('/api/v1/levy/rates')
          .set(admin)
          .send({ ratePercent: 1.5, effectiveFrom: '2099-01-01', label: `${PROBE} levy` }),
      );
      expect(rate.actions).not.toHaveLength(0);
      const rateId = rate.res.body.id as string;

      const rule = await probe('POST /api/v1/penalty-schedule', () =>
        request(server)
          .post('/api/v1/penalty-schedule')
          .set(admin)
          .send({
            reason: 'MISSED_DEADLINE',
            entityType: 'OTHER',
            fixedAmount: 1000,
            dailyAmount: 100,
            effectiveFrom: '2099-01-01',
            label: `${PROBE} penalty`,
          }),
      );
      expect(rule.actions).not.toHaveLength(0);
      const ruleId = rule.res.body.id as string;

      for (const [label, call] of [
        [
          'PATCH /api/v1/levy/rates/:id',
          () =>
            request(server)
              .patch(`/api/v1/levy/rates/${rateId}`)
              .set(admin)
              .send({ ratePercent: 1.75 }),
        ],
        [
          'DELETE /api/v1/levy/rates/:id',
          () => request(server).delete(`/api/v1/levy/rates/${rateId}`).set(admin),
        ],
        [
          'PATCH /api/v1/penalty-schedule/:id',
          () =>
            request(server)
              .patch(`/api/v1/penalty-schedule/${ruleId}`)
              .set(admin)
              .send({ dailyAmount: 250 }),
        ],
        [
          'DELETE /api/v1/penalty-schedule/:id',
          () => request(server).delete(`/api/v1/penalty-schedule/${ruleId}`).set(admin),
        ],
      ] as [string, () => request.Test][]) {
        expect(await auditFor(label, call)).not.toHaveLength(0);
      }
    });

    it('records a compliance case being closed, and a penalty forgiven', async () => {
      /*
       * `PATCH /enforcement/:id/waive` is the sharpest route in the system. It cancels money an
       * operator owes, it is the one an insider would most want unrecorded, and it is the one an
       * auditor will ask about first. Nothing measured it until now.
       *
       * The fixture defaults on purpose: an active operator of a type no other suite uses, two
       * closed periods it never filed against, and a penalty rule priced for that type. The sweep
       * that opens the cases is *not* what is being probed here — see the note in the census — so
       * this only needs the cases to exist, however they came to.
       */
      const admin = { Authorization: `Bearer ${adminToken}` };
      const cases = await openTwoCases();

      expect(
        await auditFor('PATCH /api/v1/enforcement/:id/resolve', () =>
          request(server)
            .patch(`/api/v1/enforcement/${cases[0]}/resolve`)
            .set(admin)
            .send({ note: 'The return was filed on paper and has been accepted.' }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /api/v1/enforcement/:id/waive', () =>
          request(server)
            .patch(`/api/v1/enforcement/${cases[1]}/waive`)
            .set(admin)
            .send({ note: 'Waived: the deadline fell during the outage.' }),
        ),
      ).not.toHaveLength(0);
    });

    it('records a return filed by a machine, where there is no person to ask later', async () => {
      /*
       * The strongest case for auditing in the system. A credential files returns unattended, so
       * when a figure is queried months later the audit row is the *only* answer to "where did
       * this come from". There is no person who remembers doing it.
       *
       * The actor on these rows is the credential's own service user, not the operator who issued
       * it. That id has to join the scope below; miss it and every probe here reads as unaudited
       * while the records are in fact being written correctly.
       */
      const issued = await probe('POST /api/v1/api-clients', () =>
        request(server)
          .post('/api/v1/api-clients')
          .set({ Authorization: `Bearer ${opToken}` })
          .send({ name: `${PROBE} machine`, scopes: ['READ_PERIODS', 'SUBMIT_RETURNS'] }),
      );
      expect(issued.actions).not.toHaveLength(0);
      const clientId = issued.res.body.clientId as string;
      const clientSecret = issued.res.body.clientSecret as string;
      expect(clientSecret).toBeTruthy();

      const client = await prisma.apiClient.findUnique({
        where: { id: issued.res.body.id as string },
        select: { serviceUser: { select: { id: true } } },
      });
      expect(client?.serviceUser.id).toBeTruthy();
      actorIds.push(client!.serviceUser.id);

      /** A signed machine request, built the way the guard verifies it. */
      const machine = (method: 'post' | 'put', path: string, body: unknown) => {
        const fullPath = `/api/v1${path}`;
        const raw = JSON.stringify(body);
        const timestamp = new Date().toISOString();
        const nonce = randomUUID();
        const signature = sign(clientSecret, {
          timestamp,
          nonce,
          method,
          path: fullPath,
          body: raw,
        });
        return request(server)
          [method](fullPath)
          .set('x-nca-client-id', clientId)
          .set('x-nca-client-secret', clientSecret)
          .set('x-nca-timestamp', timestamp)
          .set('x-nca-nonce', nonce)
          .set('x-nca-signature', signature)
          .set('Content-Type', 'application/json')
          .send(raw);
      };

      const opened = await probe('POST /api/v1/machine/returns', () =>
        machine('post', '/machine/returns', { periodId: machinePeriodId }),
      );
      expect(opened.actions).not.toHaveLength(0);
      const id = opened.res.body.id as string;

      expect(
        await auditFor('PUT /api/v1/machine/returns/:id/values', () =>
          machine('put', `/machine/returns/${id}/values`, {
            // Addressed by question key, not by field id: a machine has no screen to read ids off.
            values: [
              { key: 'audit_operator_name', value: 'Audit Telecom' },
              { key: 'audit_active', value: '7777' },
            ],
          }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('POST /api/v1/machine/returns/:id/submit', () =>
          machine('post', `/machine/returns/${id}/submit`, {}),
        ),
      ).not.toHaveLength(0);
    });

    it('records a signing certificate being registered and revoked', async () => {
      // A certificate is what makes a filing attributable. One registered without a record, or
      // quietly revoked, changes who can be held to a signature.
      const op = { Authorization: `Bearer ${opToken}` };
      const registered = await probe('POST /api/v1/signatures/certificates', () =>
        request(server)
          .post('/api/v1/signatures/certificates')
          .set(op)
          .send({ label: `${PROBE} signing key`, certificatePem: PROBE_CERT_PEM }),
      );
      expect(registered.actions).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/signatures/certificates/:id', () =>
          request(server)
            .delete(`/api/v1/signatures/certificates/${registered.res.body.id}`)
            .set(op),
        ),
      ).not.toHaveLength(0);
    });

    it('records a licence being filed and withdrawn', async () => {
      // The licence repository is the evidence of who may operate at all, and a document
      // withdrawn with nobody named against it is the awkward case.
      const op = { Authorization: `Bearer ${opToken}` };
      const filed = await probe('POST /api/v1/documents', () =>
        request(server)
          .post('/api/v1/documents')
          .set(op)
          .field('kind', 'LICENCE')
          .field('title', `${PROBE} operating licence`)
          .field('reference', 'AUDIT/PROBE/LIC')
          .attach('file', PDF, 'licence.pdf'),
      );
      expect(filed.actions).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/documents/:id', () =>
          request(server).delete(`/api/v1/documents/${filed.res.body.id}`).set(op),
        ),
      ).not.toHaveLength(0);
    });

    it('records an operator managing its own team, and an administrator resetting a second factor', async () => {
      /*
       * Two different kinds of privilege change in one place, because they share a fixture.
       *
       * An operator adding somebody to its own team is a route the Authority never sees happen,
       * so the audit row is the only record that a new person can now file returns on that
       * licence. And `reset-mfa` is the shape of an account takeover: it strips somebody's second
       * factor on the say-so of an administrator. Both need a name against them.
       */
      const op = { Authorization: `Bearer ${opToken}` };
      const added = await probe('POST /api/v1/operator/users', () =>
        request(server).post('/api/v1/operator/users').set(op).send({
          email: 'audit-teammate@x.test',
          firstName: 'Team',
          lastName: 'Member',
          role: Role.OPERATOR_SUBMITTER,
        }),
      );
      expect(added.actions).not.toHaveLength(0);
      const id = (added.res.body.user?.id ?? added.res.body.id) as string;
      expect(id).toBeTruthy();

      expect(
        await auditFor('PATCH /api/v1/operator/users/:id', () =>
          request(server)
            .patch(`/api/v1/operator/users/${id}`)
            .set(op)
            .send({ firstName: 'Renamed' }),
        ),
      ).not.toHaveLength(0);

      // Done before the account is removed, and on somebody other than the caller: the route
      // refuses an administrator resetting their own, which is the point of having it.
      expect(
        await auditFor('POST /api/v1/users/:id/reset-mfa', () =>
          request(server)
            .post(`/api/v1/users/${id}/reset-mfa`)
            .set({ Authorization: `Bearer ${adminToken}` })
            .send({}),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/operator/users/:id', () =>
          request(server).delete(`/api/v1/operator/users/${id}`).set(op),
        ),
      ).not.toHaveLength(0);
    });

    it('records a complaint arriving from the public, and how the Authority handled it', async () => {
      // Filed by somebody with no account at all, which makes the audit row the only trace of
      // when it arrived. What the Authority then did with it is the half a complainant may
      // eventually dispute.
      const filed = await probe(
        'POST /api/v1/complaints',
        () =>
          request(server)
            .post('/api/v1/complaints')
            .send({
              category: 'SERVICE_QUALITY',
              subject: `${PROBE} no signal`,
              description:
                'There has been no coverage in my area since last Monday and calls do not connect.',
              complainantName: 'A Citizen',
              complainantEmail: 'audit-citizen@example.test',
            }),
        [201],
        // Anonymous, so there is no actor to scope by. The row is found by the reference number
        // the filing came back with, which belongs to this complaint and no other.
        (res) => ({ entityType: 'Complaint', entityId: res.body.referenceNumber }),
      );
      expect(filed.actions).not.toHaveLength(0);

      /*
       * The internal id has to come from the database, because the public response withholds it
       * on purpose: a citizen gets a reference number and a tracking code, and nothing that
       * addresses the case file directly.
       */
      const row = await prisma.complaint.findFirst({
        where: { referenceNumber: filed.res.body.referenceNumber as string },
        select: { id: true },
      });
      expect(row?.id).toBeTruthy();

      /*
       * Evidence, attached and then removed, before the case is closed below.
       *
       * The order matters and is not incidental: a closed complaint refuses new files, so an
       * upload probe placed after the status change would fail on the fixture rather than on the
       * feature. Both calls run against the reference and tracking code the filing came back
       * with, which is all a citizen ever holds.
       */
      const attached = await probe(
        'POST /api/v1/complaints/attachments',
        () =>
          request(server)
            .post('/api/v1/complaints/attachments')
            .field('referenceNumber', filed.res.body.referenceNumber as string)
            .field('trackingCode', filed.res.body.trackingCode as string)
            .attach('file', PNG, 'mast.png'),
        [201],
        // Anonymous again, so the row is named rather than counted.
        () => ({ entityType: 'Complaint', entityId: filed.res.body.referenceNumber as string }),
      );
      expect(attached.actions).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/complaints/:id/attachments/:attachmentId', () =>
          request(server)
            .delete(`/api/v1/complaints/${row!.id}/attachments/${attached.res.body.id as string}`)
            .set({ Authorization: `Bearer ${adminToken}` }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('PATCH /api/v1/complaints/:id/status', () =>
          request(server)
            .patch(`/api/v1/complaints/${row!.id}/status`)
            .set({ Authorization: `Bearer ${adminToken}` })
            .send({ status: 'RESOLVED', resolutionNote: 'The mast has been repaired.' }),
        ),
      ).not.toHaveLength(0);
    });

    it('records a second factor being switched on, re-issued and removed', async () => {
      /*
       * MFA changes are the ones an intruder would most want unlogged, because each of them
       * changes who can get in. Removing an authenticator app is the sharpest: it is the last
       * step before an account is only a password again.
       *
       * Driven on a throwaway account rather than one of this suite's own, because enrolling a
       * second factor changes how that account signs in and every later probe here uses its
       * token.
       */
      const victimEmail = 'audit-mfa@x.test';
      const created = await prisma.user.create({
        data: {
          email: victimEmail,
          passwordHash: await hashPassword(PASSWORD),
          firstName: 'Audit',
          lastName: 'Mfa',
          role: Role.ANALYST,
        },
      });
      actorIds.push(created.id);
      const token = await login(victimEmail);
      const auth = { Authorization: `Bearer ${token}` };

      const begun = await request(server).post('/api/v1/auth/totp').set(auth).send({});
      expect(begun.status).toBe(201);
      const secret = begun.body.secret as string;
      expect(secret).toBeTruthy();

      const codes = await probe('POST /api/v1/auth/totp/confirm', () =>
        request(server)
          .post('/api/v1/auth/totp/confirm')
          .set(auth)
          .send({ code: authApp.generate(secret) }),
      );
      expect(codes.actions).not.toHaveLength(0);
      expect(codes.res.body.recoveryCodes.length).toBeGreaterThan(0);

      /*
       * The next call takes the code from the following time step, and the one after that takes a
       * recovery code. Both of those are forced, and the reasons are worth knowing.
       *
       * A code cannot be reused: the confirmed step is stored and only a later one is accepted,
       * which is the replay defence and is deliberate. So the current code is spent. The server
       * also accepts only one step either side of now, so the *only* unspent code available
       * within a test that takes under a second is the next one. Anything further out is refused
       * as being outside the window, and an older one as being behind the stored step.
       *
       * That leaves nothing for the third call, which is exactly the situation recovery codes
       * exist for — and `disable` accepts one in place of a code. Using it here is not a
       * workaround; it is the route's documented path for somebody whose phone is not to hand.
       */
      const reissued = await probe('POST /api/v1/auth/totp/recovery-codes', () =>
        request(server)
          .post('/api/v1/auth/totp/recovery-codes')
          .set(auth)
          .send({ code: nextCode(secret) }),
      );
      expect(reissued.actions).not.toHaveLength(0);
      // The fresh set, not the one from `confirm`: re-issuing replaces the old codes.
      const recoveryCode = (reissued.res.body.recoveryCodes as string[])[0]!;
      expect(recoveryCode).toBeTruthy();

      expect(
        await auditFor('DELETE /api/v1/auth/totp', () =>
          request(server).delete('/api/v1/auth/totp').set(auth).send({ code: recoveryCode }),
        ),
      ).not.toHaveLength(0);
    });

    it('records what the Authority chose to publish, and to whom it reports', async () => {
      /*
       * Three kinds of configuration that reach outside the Authority: the figures published on
       * the open portal, the schedule that emails reports out, and the feeds that pull operators'
       * data in. Each is a decision about disclosure, and each needs a name against it.
       */
      const admin = { Authorization: `Bearer ${adminToken}` };

      const indicator = await probe('POST /api/v1/public-indicators', () =>
        request(server)
          .post('/api/v1/public-indicators')
          .set(admin)
          // Keyed to this suite's own question. An indicator matches by key across every
          // published questionnaire, so a common key here publishes other people's figures.
          .send({ fieldKey: 'audit_active', label: `${PROBE} people connected` }),
      );
      expect(indicator.actions).not.toHaveLength(0);

      const schedule = await probe('POST /api/v1/report-schedules', () =>
        request(server)
          .post('/api/v1/report-schedules')
          .set(admin)
          .send({
            name: `${PROBE} monthly compliance`,
            kind: 'COMPLIANCE_WORKBOOK',
            frequency: 'MONTHLY',
            dayOfPeriod: 1,
            hour: 7,
            recipientIds: [actorIds[0]],
          }),
      );
      expect(schedule.actions).not.toHaveLength(0);

      const agreement = await probe('POST /api/v1/feeds/agreements', () =>
        request(server)
          .post('/api/v1/feeds/agreements')
          .set(admin)
          .send({
            entityId: entityId,
            reference: `${PROBE}/FEED/1`,
            title: `${PROBE} data sharing`,
            startsAt: '2026-01-01',
          }),
      );
      expect(agreement.actions).not.toHaveLength(0);

      const feed = await probe('POST /api/v1/feeds', () =>
        request(server)
          .post('/api/v1/feeds')
          .set(admin)
          .send({
            agreementId: agreement.res.body.id,
            name: `${PROBE} traffic counters`,
            url: 'https://feeds.audit-probe.example/metrics',
            frequency: 'DAILY',
          }),
      );
      expect(feed.actions).not.toHaveLength(0);

      for (const [label, call] of [
        [
          'PATCH /api/v1/public-indicators/:id',
          () =>
            request(server)
              .patch(`/api/v1/public-indicators/${indicator.res.body.id}`)
              .set(admin)
              .send({ label: `${PROBE} people connected, renamed` }),
        ],
        [
          'DELETE /api/v1/public-indicators/:id',
          () =>
            request(server).delete(`/api/v1/public-indicators/${indicator.res.body.id}`).set(admin),
        ],
        [
          'PATCH /api/v1/report-schedules/:id',
          () =>
            request(server)
              .patch(`/api/v1/report-schedules/${schedule.res.body.id}`)
              .set(admin)
              .send({ hour: 8 }),
        ],
        [
          'DELETE /api/v1/report-schedules/:id',
          () =>
            request(server).delete(`/api/v1/report-schedules/${schedule.res.body.id}`).set(admin),
        ],
        [
          'PATCH /api/v1/feeds/:id',
          () =>
            request(server)
              .patch(`/api/v1/feeds/${feed.res.body.id}`)
              .set(admin)
              .send({ name: `${PROBE} traffic counters, renamed` }),
        ],
        [
          'DELETE /api/v1/feeds/:id',
          () => request(server).delete(`/api/v1/feeds/${feed.res.body.id}`).set(admin),
        ],
        [
          'PATCH /api/v1/feeds/agreements/:id',
          () =>
            request(server)
              .patch(`/api/v1/feeds/agreements/${agreement.res.body.id}`)
              .set(admin)
              .send({ title: `${PROBE} data sharing, revised` }),
        ],
        [
          'DELETE /api/v1/feeds/agreements/:id',
          () =>
            request(server).delete(`/api/v1/feeds/agreements/${agreement.res.body.id}`).set(admin),
        ],
      ] as [string, () => request.Test][]) {
        expect(await auditFor(label, call)).not.toHaveLength(0);
      }
    });

    it('records the whole account lifecycle: signing up, being challenged, and resetting a password', async () => {
      /*
       * Where an attacker works. Creating an account, getting past the second factor, and
       * recovering a password are the three ways in that do not involve knowing one, and each of
       * them leaves this row as the only evidence it happened.
       *
       * A separate throwaway account, because this drives a full sign-in and then changes the
       * password — neither of which should happen to an account the other probes depend on.
       */
      const email = 'audit-lifecycle@x.test';
      const signedUp = await probe(
        'POST /api/v1/auth/signup',
        () =>
          request(server)
            .post('/api/v1/auth/signup')
            .send({ email, firstName: 'Audit', lastName: 'Lifecycle', password: PASSWORD }),
        [201],
        /*
         * Nobody is signed in yet, so there is no actor to scope by, and the new account's id is
         * not knowable until the row exists. The lookup makes this exact: another suite signing
         * up at the same moment cannot satisfy it, which a match on the action alone would.
         */
        async () => ({
          action: AuditAction.USER_SIGNUP,
          entityId: (await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id,
        }),
      );
      expect(signedUp.actions).not.toHaveLength(0);

      const account = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      expect(account?.id).toBeTruthy();
      actorIds.push(account!.id);

      // Signing in gets as far as the challenge, which is what `resend-otp` needs.
      const challenged = await probe('POST /api/v1/auth/login', () =>
        request(server).post('/api/v1/auth/login').send({ email, password: PASSWORD }),
      );
      expect(challenged.actions).not.toHaveLength(0);
      const challengeId = challenged.res.body.challengeId as string;
      expect(challengeId).toBeTruthy();

      const resent = await probe('POST /api/v1/auth/resend-otp', () =>
        request(server).post('/api/v1/auth/resend-otp').send({ challengeId }),
      );
      expect(resent.actions).not.toHaveLength(0);

      expect(
        await auditFor('POST /api/v1/auth/verify-otp', () =>
          request(server)
            .post('/api/v1/auth/verify-otp')
            // The challenge that the resend issued: the first one is spent by re-issuing.
            .send({ challengeId: resent.res.body.challengeId ?? challengeId, code: OTP }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('POST /api/v1/auth/forgot-password', () =>
          request(server).post('/api/v1/auth/forgot-password').send({ email }),
        ),
      ).not.toHaveLength(0);

      /*
       * The reset token has to be planted, and that is not a shortcut.
       *
       * Only its hash is stored and the readable half leaves by email, which is the right design
       * and means no test can recover it from the database. Writing a row whose hash matches a
       * token of our own exercises the route exactly as a person clicking the link in their inbox
       * would, and it is the audit record that is under test here, not the mail provider.
       */
      const rawToken = randomUUID();
      await prisma.passwordResetToken.create({
        data: {
          userId: account!.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      expect(
        await auditFor('POST /api/v1/auth/reset-password', () =>
          request(server)
            .post('/api/v1/auth/reset-password')
            .send({ token: rawToken, password: 'An0therPassw0rd!' }),
        ),
      ).not.toHaveLength(0);
    });

    it('records a phone number being confirmed and later removed', async () => {
      /*
       * A confirmed number is a way back into an account, so adding or removing one changes who
       * can recover it. That is the same class of change as an authenticator app, and it deserves
       * the same record.
       *
       * Driven on a throwaway account: once a number is confirmed, that account's sign-in codes
       * also go by text, and the probes above use their own tokens.
       */
      const email = 'audit-phone@x.test';
      const account = await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(PASSWORD),
          firstName: 'Audit',
          lastName: 'Phone',
          role: Role.ANALYST,
        },
      });
      actorIds.push(account.id);
      const auth = { Authorization: `Bearer ${await login(email)}` };

      expect(
        await auditFor('POST /api/v1/auth/phone', () =>
          request(server).post('/api/v1/auth/phone').set(auth).send({ phone: '+211920000111' }),
        ),
      ).not.toHaveLength(0);

      /*
       * The code is read out of the text, because that is the only way a real person gets it
       * either. It is a random six digits, deliberately not the demo sign-in code: a code
       * everybody knows would prove nothing about who holds the handset.
       */
      const code = sms.lastCode();
      expect(code).toMatch(/^\d{6}$/);

      expect(
        await auditFor('POST /api/v1/auth/phone/verify', () =>
          request(server).post('/api/v1/auth/phone/verify').set(auth).send({ code }),
        ),
      ).not.toHaveLength(0);

      expect(
        await auditFor('DELETE /api/v1/auth/phone', () =>
          request(server).delete('/api/v1/auth/phone').set(auth),
        ),
      ).not.toHaveLength(0);
    });

    it('records a feed being pulled and a report being sent out', async () => {
      /*
       * Two jobs that reach outside the Authority when somebody presses a button, and both are
       * audited whatever the outcome — which is the point. A feed that could not be reached and a
       * report that went to the wrong list are exactly the events somebody asks about later.
       */
      const admin = { Authorization: `Bearer ${adminToken}` };
      const agreement = await request(server)
        .post('/api/v1/feeds/agreements')
        .set(admin)
        .send({
          entityId,
          reference: `${PROBE}/FEED/2`,
          title: `${PROBE} data sharing, run`,
          startsAt: '2026-01-01',
        });
      expect(agreement.status).toBe(201);

      const feed = await request(server)
        .post('/api/v1/feeds')
        .set(admin)
        .send({
          agreementId: agreement.body.id,
          name: `${PROBE} unreachable counters`,
          // `.example` is reserved and resolves nowhere, so the run fails fast and without
          // touching anybody's network. A failed run is still a run, and still audited.
          url: 'https://feed.audit-probe.example/metrics',
          frequency: 'DAILY',
        });
      expect(feed.status).toBe(201);

      expect(
        await auditFor('POST /api/v1/feeds/:id/run', () =>
          request(server).post(`/api/v1/feeds/${feed.body.id}/run`).set(admin).send({}),
        ),
      ).not.toHaveLength(0);

      const schedule = await request(server)
        .post('/api/v1/report-schedules')
        .set(admin)
        .send({
          name: `${PROBE} send now`,
          kind: 'COMPLIANCE_WORKBOOK',
          frequency: 'MONTHLY',
          dayOfPeriod: 1,
          hour: 7,
          recipientIds: [actorIds[0]],
        });
      expect(schedule.status).toBe(201);

      expect(
        await auditFor('POST /api/v1/report-schedules/:id/send', () =>
          request(server)
            .post(`/api/v1/report-schedules/${schedule.body.id}/send`)
            .set(admin)
            .send({}),
        ),
      ).not.toHaveLength(0);
    });

    it('records answers loaded in bulk from a spreadsheet', async () => {
      /*
       * The one route where a single upload can rewrite every figure in a return at once, which
       * makes it the one where an unrecorded change does the most damage.
       *
       * The workbook is the one the portal itself hands out, filled in the way an operator fills
       * it offline. Building a spreadsheet by hand instead would test a file the system never
       * produces.
       */
      const op = { Authorization: `Bearer ${opToken}` };
      const admin = { Authorization: `Bearer ${adminToken}` };

      /*
       * Its own period, because opening a return hands back the existing one for that period if
       * there is one, and the earlier probes have already submitted theirs. A submitted return
       * refuses edits — correctly — and the refusal would read here as a missing audit record.
       */
      const templateId = (
        await request(server).get(`/api/v1/reporting-periods/${periodId}`).set(admin)
      ).body.templateId as string;
      const period = await request(server)
        .post('/api/v1/reporting-periods')
        .set(admin)
        .send({
          templateId,
          frequency: 'QUARTERLY',
          label: `${PROBE} 2027 Q4 workbook`,
          periodStart: '2027-10-01',
          periodEnd: '2027-12-31',
          dueDate: '2028-01-15',
        });
      expect(period.status).toBe(201);

      const draft = await request(server)
        .post('/api/v1/submissions')
        .set(op)
        .send({ periodId: period.body.id });
      expect([200, 201]).toContain(draft.status);
      const id = draft.body.id as string;

      const downloaded = await request(server)
        .get(`/api/v1/submissions/${id}/workbook`)
        .set(op)
        .buffer()
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(downloaded.status).toBe(200);

      /*
       * The layout is the portal's own: six rows of heading and instructions, then a row per
       * question with the key in column 2 and the answer in column 4. Filled the way the operator
       * fills it, and the count is asserted so an empty upload cannot pass for a filled one.
       */
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(downloaded.body as ArrayBuffer);
      const sheet = book.worksheets[0]!;
      let answered = 0;
      sheet.eachRow((row, index) => {
        if (index <= 6) return;
        if (!String(row.getCell(2).value ?? '')) return;
        row.getCell(4).value = '123';
        answered += 1;
      });
      expect(answered).toBeGreaterThan(0);
      const filled = Buffer.from((await book.xlsx.writeBuffer()) as ArrayBuffer);

      expect(
        await auditFor('POST /api/v1/submissions/:id/workbook', () =>
          request(server)
            .post(`/api/v1/submissions/${id}/workbook`)
            .set(op)
            .attach('file', filled, 'return.xlsx'),
        ),
      ).not.toHaveLength(0);
    });
  });

  describe('the probe itself', () => {
    it('notices when nothing is written', async () => {
      // Pointed at a route declared as writing nothing. If this came back with entries, the probe
      // would be counting somebody else's rows and every check above would be meaningless.
      const written = await auditFor('POST /api/v1/notifications/read-all', () =>
        request(server)
          .post('/api/v1/notifications/read-all')
          .set('Authorization', `Bearer ${opToken}`)
          .send({}),
      );
      expect(written).toHaveLength(0);
    });
  });

  /*
   * --- Does the file measure what it says it measures? ------------------------------------
   *
   * The reason this exists: for a long time every `POST` in this file was a fixture whose only
   * check was `expect(201)`, while the notes above described the routes as covered. Both halves
   * were honest on their own and the pair was not, and nothing went red. The list below is the
   * claim, and the two tests after it are what make the claim cost something.
   */
  const PROBED: string[] = [
    // The regulated record
    'POST /api/v1/submissions',
    'PUT /api/v1/submissions/:id/values',
    'POST /api/v1/submissions/:id/submit',
    'POST /api/v1/submissions/:id/revise',
    'DELETE /api/v1/submissions/:id',
    'POST /api/v1/submissions/:id/attachments',
    'POST /api/v1/submissions/:id/workbook',
    'DELETE /api/v1/submissions/:id/attachments/:attachmentId',
    'POST /api/v1/workflow/:id/decision',

    // Filed by a machine, with nobody present
    'POST /api/v1/api-clients',
    'PATCH /api/v1/api-clients/:id',
    'POST /api/v1/api-clients/:id/rotate',
    'DELETE /api/v1/api-clients/:id',
    'POST /api/v1/machine/returns',
    'PUT /api/v1/machine/returns/:id/values',
    'POST /api/v1/machine/returns/:id/submit',
    'POST /api/v1/signatures/certificates',
    'DELETE /api/v1/signatures/certificates/:id',

    // The questionnaire
    'POST /api/v1/templates',
    'PATCH /api/v1/templates/:id',
    'POST /api/v1/templates/:id/publish',
    'POST /api/v1/templates/:id/new-version',
    'DELETE /api/v1/templates/:id',
    'POST /api/v1/templates/:id/sections',
    'PATCH /api/v1/templates/:id/sections/:sectionId',
    'DELETE /api/v1/templates/:id/sections/:sectionId',
    'POST /api/v1/templates/:id/sections/:sectionId/fields',
    'PATCH /api/v1/templates/:id/sections/:sectionId/fields/:fieldId',
    'DELETE /api/v1/templates/:id/sections/:sectionId/fields/:fieldId',
    'POST /api/v1/templates/:id/rules',
    'PATCH /api/v1/templates/:id/rules/:ruleId',
    'DELETE /api/v1/templates/:id/rules/:ruleId',

    // When operators must file
    'POST /api/v1/reporting-periods',
    'PATCH /api/v1/reporting-periods/:id',
    'POST /api/v1/reporting-periods/:id/open',
    'POST /api/v1/reporting-periods/:id/close',
    'DELETE /api/v1/reporting-periods/:id',

    // Money and consequence
    'POST /api/v1/levy/rates',
    'PATCH /api/v1/levy/rates/:id',
    'DELETE /api/v1/levy/rates/:id',
    'POST /api/v1/penalty-schedule',
    'PATCH /api/v1/penalty-schedule/:id',
    'DELETE /api/v1/penalty-schedule/:id',
    'PATCH /api/v1/enforcement/:id/resolve',
    'PATCH /api/v1/enforcement/:id/waive',
    'POST /api/v1/enforcement/:id/orders',
    'PATCH /api/v1/enforcement/orders/:orderId/approve',
    'PATCH /api/v1/enforcement/orders/:orderId/revoke',

    // Who exists and what they may do
    'POST /api/v1/entities',
    'PATCH /api/v1/entities/:id',
    'PATCH /api/v1/entities/:id/status',
    'DELETE /api/v1/entities/:id',
    'POST /api/v1/users',
    'PATCH /api/v1/users/:id',
    'PATCH /api/v1/users/:id/role',
    'DELETE /api/v1/users/:id',
    'POST /api/v1/auth/login',
    'POST /api/v1/users/:id/reset-mfa',
    'POST /api/v1/operator/users',
    'PATCH /api/v1/operator/users/:id',
    'DELETE /api/v1/operator/users/:id',

    'POST /api/v1/auth/signup',
    'POST /api/v1/auth/resend-otp',
    'POST /api/v1/auth/verify-otp',
    'POST /api/v1/auth/forgot-password',
    'POST /api/v1/auth/reset-password',
    'POST /api/v1/auth/phone',
    'POST /api/v1/auth/phone/verify',
    'DELETE /api/v1/auth/phone',
    'POST /api/v1/auth/totp/confirm',
    'POST /api/v1/auth/totp/recovery-codes',
    'DELETE /api/v1/auth/totp',

    // Decisions about disclosure: what is published, sent out, or pulled in
    'POST /api/v1/public-indicators',
    'PATCH /api/v1/public-indicators/:id',
    'DELETE /api/v1/public-indicators/:id',
    'POST /api/v1/report-schedules',
    'PATCH /api/v1/report-schedules/:id',
    'DELETE /api/v1/report-schedules/:id',
    'POST /api/v1/feeds/agreements',
    'PATCH /api/v1/feeds/agreements/:id',
    'DELETE /api/v1/feeds/agreements/:id',
    'POST /api/v1/feeds',
    'POST /api/v1/feeds/:id/run',
    'POST /api/v1/report-schedules/:id/send',
    'PATCH /api/v1/feeds/:id',
    'DELETE /api/v1/feeds/:id',

    // Arriving from outside, with no account behind it
    'POST /api/v1/complaints',
    'POST /api/v1/complaints/attachments',
    'DELETE /api/v1/complaints/:id/attachments/:attachmentId',
    'PATCH /api/v1/complaints/:id/status',

    // The operator's own records
    'POST /api/v1/agents',
    'PATCH /api/v1/agents/:id',
    'DELETE /api/v1/agents/:id',
    'POST /api/v1/geo/sites',
    'POST /api/v1/geo/links',
    'PATCH /api/v1/geo/links/:id',
    'DELETE /api/v1/geo/links/:id',
    'PATCH /api/v1/geo/sites/:id',
    'DELETE /api/v1/geo/sites/:id',
    'POST /api/v1/documents',
    'DELETE /api/v1/documents/:id',
    'POST /api/v1/reference-data',
    'PATCH /api/v1/reference-data/:id',
    'DELETE /api/v1/reference-data/:id',
  ];

  describe('what this file claims to measure', () => {
    it('drove every route it claims to probe', () => {
      // A probe that was renamed, skipped, or turned back into a plain `expect(201)` shows up
      // here. Without this the claim above would simply stop being true, quietly.
      const missing = PROBED.filter((sig) => !probed.has(sig));
      if (missing.length > 0) {
        throw new Error(
          'These are listed in PROBED but no probe actually drove them in this run. Either the ' +
            'probe is gone, or its label no longer matches the route signature:\n  ' +
            missing.join('\n  '),
        );
      }
    });

    it('labels every probe with a route the census knows', () => {
      /*
       * The label is the only link between a probe and the route it claims to cover, and it is a
       * free-text string. One that drifts — a typo, or a path renamed in the controller — would
       * sit in `probed` looking like coverage while matching nothing at all.
       */
      const notARoute = [...probed].filter((sig) => !(sig in MUST_AUDIT) && !(sig in NOT_AUDITED));
      if (notARoute.length > 0) {
        throw new Error(
          'A probe used a label that matches no route in the census, so it is measuring ' +
            `something nobody has classified:\n  ${notARoute.join('\n  ')}`,
        );
      }
    });

    it('declares every probe it actually ran', () => {
      // The other direction, so the list cannot fall behind the tests. Add a probe and this
      // fails until it is declared, which is what keeps the list worth reading.
      const undeclared = [...probed].filter((sig) => sig in MUST_AUDIT && !PROBED.includes(sig));
      expect(undeclared).toEqual([]);
    });
  });
});
