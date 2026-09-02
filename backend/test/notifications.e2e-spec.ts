import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role, TemplateStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** Notifications raised by the submission/review flow, over real HTTP (Q8). */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const opEmail = 'e2e-nt-op@x.test';
  const checkerEmail = 'e2e-nt-checker@nca.test';
  const verifierEmail = 'e2e-nt-verifier@nca.test';
  const approverEmail = 'e2e-nt-approver@nca.test';
  const emails = [opEmail, checkerEmail, verifierEmail, approverEmail];
  const licence = 'E2E/NT';
  const tplName = 'E2E Notifications Template';

  let opToken: string;
  let checkerToken: string;
  let verifierToken: string;
  let approverToken: string;
  let templateId: string;
  let nameFieldId: string;
  let periodSeq = 0;

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
    await prisma.notification.deleteMany({ where: { recipient: { email: { in: emails } } } });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: licence } } });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: licence } });
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
    const entity = await prisma.entity.create({
      data: {
        name: 'Notify Op',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Op',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    for (const [email, role] of [
      [checkerEmail, Role.CHECKER],
      [verifierEmail, Role.VERIFIER],
      [approverEmail, Role.APPROVER],
    ] as const) {
      await prisma.user.create({
        data: { email, passwordHash, firstName: role, lastName: 'NCA', role },
      });
    }

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
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
      include: { sections: { include: { fields: true } } },
    });
    templateId = tpl.id;
    nameFieldId = tpl.sections[0].fields.find((f) => f.key === 'op_name')!.id;

    opToken = await login(opEmail);
    checkerToken = await login(checkerEmail);
    verifierToken = await login(verifierEmail);
    approverToken = await login(approverEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A fresh period each call (one return per entity+period), then submit a return; returns its id. */
  async function submitReturn(): Promise<string> {
    periodSeq += 1;
    const period = await prisma.reportingPeriod.create({
      data: {
        templateId,
        frequency: 'QUARTERLY',
        label: `2026 Q${periodSeq}`,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        dueDate: new Date('2999-04-15'),
        status: 'OPEN',
        openedAt: new Date(),
      },
    });
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opToken))
      .send({ periodId: period.id })
      .expect(201);
    const id = draft.body.id;
    await request(server)
      .put(`/api/v1/submissions/${id}/values`)
      .set(auth(opToken))
      .send({ values: [{ fieldId: nameFieldId, valueText: 'Notify Operator' }] })
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opToken))
      .send({ signedName: 'Op User' })
      .expect(201);
    return id;
  }

  const decide = (id: string, token: string, decision: string, comment?: string) =>
    request(server)
      .post(`/api/v1/workflow/${id}/decision`)
      .set(auth(token))
      .send({ decision, comment });

  /**
   * A reviewer's feed, read a page at a time large enough to contain this suite's own notification.
   *
   * Reviewers are notified by role, globally, which is correct in production: whoever holds the
   * Checker role should see a return waiting for them. It does mean a parallel suite filing a
   * return puts a notification in this suite's checker's feed too, and on the default page size the
   * one being looked for can be pushed off the first page.
   */
  const list = async (token: string, unreadOnly = false) =>
    (
      await request(server)
        .get('/api/v1/notifications')
        .query({ pageSize: 100, ...(unreadOnly ? { unreadOnly: 'true' } : {}) })
        .set(auth(token))
        .expect(200)
    ).body;

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/notifications').expect(401);
  });

  it('notifies the Checker when a return is submitted', async () => {
    const id = await submitReturn();
    const feed = await list(checkerToken);
    const note = feed.data.find((n: { submissionId: string }) => n.submissionId === id);
    expect(note).toBeDefined();
    expect(note.type).toBe('RETURN_AWAITING_REVIEW');
    expect(note.linkPath).toBe(`/submissions/${id}`);
    expect(note.readAt).toBeNull();
    expect(feed.unread).toBeGreaterThanOrEqual(1);
  });

  it('counts and clears unread with mark-read and mark-all-read', async () => {
    // Advance a return to the Verifier so they have a fresh notification to act on.
    const id = await submitReturn();
    await decide(id, checkerToken, 'APPROVE', 'Looks complete').expect(201);

    // Assert on THIS return's notification, not the global unread count: a reviewer is told about
    // every return reaching their stage, so a suite running in parallel moves that total too.
    const unreadForThisReturn = async () => {
      const feed = await list(verifierToken, true);
      return feed.data.filter((n: { submissionId: string }) => n.submissionId === id).length;
    };
    expect(await unreadForThisReturn()).toBe(1);

    const feed = await list(verifierToken, true);
    const noteId = feed.data.find((n: { submissionId: string }) => n.submissionId === id).id;
    await request(server)
      .patch(`/api/v1/notifications/${noteId}/read`)
      .set(auth(verifierToken))
      .expect(200);

    await request(server)
      .post('/api/v1/notifications/read-all')
      .set(auth(verifierToken))
      .expect(201);
    // Mark-all-read clears this reviewer's own bell, whatever else arrived while the suite ran.
    expect(await unreadForThisReturn()).toBe(0);
  });

  it('notifies the operator when their return is finally approved', async () => {
    const id = await submitReturn();
    await decide(id, checkerToken, 'APPROVE').expect(201);
    await decide(id, verifierToken, 'APPROVE').expect(201);
    await decide(id, approverToken, 'APPROVE').expect(201);

    const feed = await list(opToken);
    const note = feed.data.find((n: { submissionId: string }) => n.submissionId === id);
    expect(note).toBeDefined();
    expect(note.type).toBe('RETURN_APPROVED');
  });

  it('notifies the operator with the reason when their return is rejected', async () => {
    const id = await submitReturn();
    await decide(id, checkerToken, 'REJECT', 'Totals do not add up').expect(201);

    const feed = await list(opToken);
    const note = feed.data.find(
      (n: { submissionId: string; type: string }) =>
        n.submissionId === id && n.type === 'RETURN_REJECTED',
    );
    expect(note).toBeDefined();
    expect(note.body).toContain('Totals do not add up');
  });

  it('keeps notifications private to their recipient', async () => {
    // The operator's approved/rejected notes must never appear in a reviewer's feed, and vice versa.
    const opFeed = await list(opToken);
    const opNoteId = opFeed.data[0].id;
    await request(server)
      .patch(`/api/v1/notifications/${opNoteId}/read`)
      .set(auth(checkerToken))
      .expect(404);

    const checkerFeed = await list(checkerToken);
    expect(
      checkerFeed.data.every((n: { type: string }) => n.type === 'RETURN_AWAITING_REVIEW'),
    ).toBe(true);
  });
});
