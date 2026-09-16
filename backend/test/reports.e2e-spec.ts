import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  ReportCoverage,
  ReportFrequency,
  Role,
  ScheduledReportKind,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(45000);
const OTP = '123456';

/**
 * Scheduled sector reports (Phase 2).
 *
 * Email runs in demo mode under NODE_ENV=test, so a send is proved by the endpoint's own count and
 * by `lastRunAt` moving, not by intercepting SendGrid.
 */
describe('Scheduled reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-rep-admin@nca.test';
  const analystEmail = 'e2e-rep-analyst@nca.test';
  const opEmail = 'e2e-rep-op@x.test';
  const emails = [adminEmail, analystEmail, opEmail];
  const licence = 'E2E/REP/A';
  const scheduleNames = ['E2E monthly compliance', 'E2E quarterly levy'];

  let adminToken: string;
  let opToken: string;
  let adminId: string;
  let analystId: string;
  let opUserId: string;

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
    await prisma.reportSchedule.deleteMany({ where: { name: { in: scheduleNames } } });
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
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NCA',
        role: Role.ADMIN,
      },
    });
    adminId = admin.id;
    const analyst = await prisma.user.create({
      data: {
        email: analystEmail,
        passwordHash,
        firstName: 'Ana',
        lastName: 'Lyst',
        role: Role.ANALYST,
      },
    });
    analystId = analyst.id;

    const entity = await prisma.entity.create({
      data: {
        name: 'Rep Op',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    const op = await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'Op',
        lastName: 'User',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    opUserId = op.id;

    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /*
   * Coverage defaults to LAST_CLOSED_PERIOD, which is what NCA asked for and what a new schedule
   * should be. The tests above it are about recipients, permissions and the timetable, none of
   * which should depend on whether some other suite happens to have a closed period in the shared
   * database at that moment, so they say LATEST_ACTIVITY unless they are testing coverage itself.
   */
  const createSchedule = (body: Record<string, unknown>, expected = 201) =>
    request(server)
      .post('/api/v1/report-schedules')
      .set(auth(adminToken))
      .send({ coverage: ReportCoverage.LATEST_ACTIVITY, ...body })
      .expect(expected);

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/report-schedules').expect(401);
  });

  it('keeps operators out entirely (403)', async () => {
    await request(server).get('/api/v1/report-schedules').set(auth(opToken)).expect(403);
    await request(server)
      .post('/api/v1/report-schedules')
      .set(auth(opToken))
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('will not send a report to an operator', async () => {
    const res = await createSchedule(
      {
        name: scheduleNames[0],
        recipientIds: [adminId, opUserId],
      },
      400,
    );
    expect(JSON.stringify(res.body)).toContain('Authority staff');
  });

  it('refuses a day of the month a report could not fall on (400)', async () => {
    await createSchedule({ name: scheduleNames[0], dayOfPeriod: 31 }, 400);
  });

  it('refuses a weekday outside the week for a weekly report (400)', async () => {
    await createSchedule(
      { name: scheduleNames[0], frequency: ReportFrequency.WEEKLY, dayOfPeriod: 9 },
      400,
    );
  });

  it('creates a schedule with its distribution list', async () => {
    const res = await createSchedule({
      name: scheduleNames[0],
      kind: ScheduledReportKind.COMPLIANCE_WORKBOOK,
      frequency: ReportFrequency.MONTHLY,
      dayOfPeriod: 1,
      hour: 7,
      recipientIds: [adminId, analystId],
    });
    expect(res.body.name).toBe(scheduleNames[0]);
    expect(res.body.lastRunAt).toBeNull();
    expect(res.body.recipients).toHaveLength(2);
    // The list carries names an administrator can check, not raw addresses typed in by hand.
    expect(res.body.recipients[0].user).toHaveProperty('firstName');
  });

  it('replaces the distribution list rather than adding to it', async () => {
    const list = await request(server)
      .get('/api/v1/report-schedules')
      .set(auth(adminToken))
      .expect(200);
    const schedule = list.body.find((s: { name: string }) => s.name === scheduleNames[0]);

    const res = await request(server)
      .patch(`/api/v1/report-schedules/${schedule.id}`)
      .set(auth(adminToken))
      .send({ recipientIds: [analystId] })
      .expect(200);
    expect(res.body.recipients).toHaveLength(1);
    expect(res.body.recipients[0].user.id).toBe(analystId);
  });

  it('sends on demand and records that it went out', async () => {
    const list = await request(server)
      .get('/api/v1/report-schedules')
      .set(auth(adminToken))
      .expect(200);
    const schedule = list.body.find((s: { name: string }) => s.name === scheduleNames[0]);
    expect(schedule.lastRunAt).toBeNull();

    const res = await request(server)
      .post(`/api/v1/report-schedules/${schedule.id}/send`)
      .set(auth(adminToken))
      .expect(201);
    expect(res.body).toMatchObject({ sent: 1, recipients: 1 });

    const after = await prisma.reportSchedule.findUnique({
      where: { id: schedule.id },
      select: { lastRunAt: true, lastError: true },
    });
    expect(after!.lastRunAt).not.toBeNull();
    expect(after!.lastError).toBeNull();
  });

  it('refuses to send a report with nobody on the list (400)', async () => {
    const created = await createSchedule({
      name: scheduleNames[1],
      kind: ScheduledReportKind.LEVY_WORKBOOK,
      frequency: ReportFrequency.QUARTERLY,
      dayOfPeriod: 15,
    });
    await request(server)
      .post(`/api/v1/report-schedules/${created.body.id}/send`)
      .set(auth(adminToken))
      .expect(400);
  });

  describe('what each run covers (NCA, 15 September 2026)', () => {
    /*
     * "Report Scheduling: Include date selection functionality." Asked back, and answered: each
     * run should send the period that has just closed, rather than a date fixed once when the
     * schedule was made.
     *
     * Which makes the window a thing decided at send time, and that is what these tests hold. The
     * failure worth guarding is not a wrong date on a screen: it is a levy statement that goes out
     * every quarter, covers whatever period happens to be latest, and says nothing about which.
     */
    const coverageNames = ['E2E coverage closed', 'E2E coverage latest'];
    const coverageLicence = 'E2E/REP/COV';
    let templateId: string;
    let olderPeriodId: string;
    let newerPeriodId: string;

    beforeAll(async () => {
      await prisma.reportSchedule.deleteMany({ where: { name: { in: coverageNames } } });
      await prisma.reportingPeriod.deleteMany({ where: { template: { name: coverageLicence } } });
      await prisma.reportingTemplate.deleteMany({ where: { name: coverageLicence } });

      const template = await prisma.reportingTemplate.create({
        data: {
          name: coverageLicence,
          version: 1,
          status: TemplateStatus.PUBLISHED,
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      templateId = template.id;

      /*
       * Two closed periods, and the older one closed last.
       *
       * The pair that tells the two plausible readings apart. "The period that has just closed"
       * means the most recent period, not the one somebody most recently got round to closing —
       * and a backlog cleared out of order is exactly how those two come apart. Dated far enough
       * ahead that no other suite's period outranks them in the shared database.
       */
      const older = await prisma.reportingPeriod.create({
        data: {
          templateId,
          frequency: 'QUARTERLY',
          label: 'E2E 2098 Q1',
          periodStart: new Date('2098-01-01'),
          periodEnd: new Date('2098-03-31'),
          dueDate: new Date('2098-04-15'),
          status: 'CLOSED',
          closedAt: new Date('2098-12-01'),
        },
        select: { id: true },
      });
      olderPeriodId = older.id;

      const newer = await prisma.reportingPeriod.create({
        data: {
          templateId,
          frequency: 'QUARTERLY',
          label: 'E2E 2098 Q2',
          periodStart: new Date('2098-04-01'),
          periodEnd: new Date('2098-06-30'),
          dueDate: new Date('2098-07-15'),
          status: 'CLOSED',
          closedAt: new Date('2098-08-01'),
        },
        select: { id: true },
      });
      newerPeriodId = newer.id;
    });

    afterAll(async () => {
      await prisma.reportSchedule.deleteMany({ where: { name: { in: coverageNames } } });
      await prisma.reportingPeriod.deleteMany({ where: { templateId } });
      await prisma.reportingTemplate.deleteMany({ where: { id: templateId } });
    });

    it('defaults a new schedule to the period that has just closed', async () => {
      // The default matters more than it looks. Somebody setting up a monthly levy statement and
      // not touching this field should get a statement for a finished period, not one that
      // restates itself every month.
      const created = await request(server)
        .post('/api/v1/report-schedules')
        .set(auth(adminToken))
        .send({
          name: coverageNames[0],
          kind: ScheduledReportKind.LEVY_WORKBOOK,
          frequency: ReportFrequency.MONTHLY,
          dayOfPeriod: 1,
          recipientIds: [adminId],
        })
        .expect(201);
      expect(created.body.coverage).toBe(ReportCoverage.LAST_CLOSED_PERIOD);
    });

    it('sends the most recent closed period, not the most recently closed one', async () => {
      const list = await request(server)
        .get('/api/v1/report-schedules')
        .set(auth(adminToken))
        .expect(200);
      const schedule = list.body.find((s: { name: string }) => s.name === coverageNames[0]);

      await request(server)
        .post(`/api/v1/report-schedules/${schedule.id}/send`)
        .set(auth(adminToken))
        .expect(201);

      // The audit row is where the window is recorded, and it is the only place a reader can later
      // check which quarter a statement in their inbox was built from.
      const entry = await prisma.auditLog.findFirst({
        where: {
          entityType: 'ReportSchedule',
          entityId: schedule.id,
          action: 'REPORT_SCHEDULE_SENT',
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      const metadata = entry!.metadata as { period?: string; coverage?: string };
      expect(metadata.coverage).toBe(ReportCoverage.LAST_CLOSED_PERIOD);
      // Q2 ends after Q1, even though Q1 was closed months later.
      expect(metadata.period).toBe('E2E 2098 Q2');
      expect(newerPeriodId).not.toBe(olderPeriodId);
    });

    it('fixes no period when the report is about how things stand now', async () => {
      const created = await request(server)
        .post('/api/v1/report-schedules')
        .set(auth(adminToken))
        .send({
          name: coverageNames[1],
          kind: ScheduledReportKind.COMPLIANCE_WORKBOOK,
          frequency: ReportFrequency.WEEKLY,
          dayOfPeriod: 1,
          coverage: ReportCoverage.LATEST_ACTIVITY,
          recipientIds: [adminId],
        })
        .expect(201);

      await request(server)
        .post(`/api/v1/report-schedules/${created.body.id}/send`)
        .set(auth(adminToken))
        .expect(201);

      const entry = await prisma.auditLog.findFirst({
        where: {
          entityType: 'ReportSchedule',
          entityId: created.body.id,
          action: 'REPORT_SCHEDULE_SENT',
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      const metadata = entry!.metadata as { period?: string };
      // A compliance report chases the operators who have not filed for the period that is open,
      // so pinning it to a closed one would chase nobody.
      expect(metadata.period).toBe('the latest figures');
    });

    it('refuses to send rather than quietly covering a different window', async () => {
      /*
       * With nothing closed, a report set up to cover the period that has just closed has no
       * window. Falling back to "the latest" would produce a file that looks right and is not, and
       * nobody would find out. Failing puts it on the schedule's own error line instead.
       */
      await prisma.reportingPeriod.updateMany({
        where: { status: 'CLOSED' },
        data: { status: 'OPEN' },
      });
      try {
        const list = await request(server)
          .get('/api/v1/report-schedules')
          .set(auth(adminToken))
          .expect(200);
        const schedule = list.body.find((s: { name: string }) => s.name === coverageNames[0]);

        const res = await request(server)
          .post(`/api/v1/report-schedules/${schedule.id}/send`)
          .set(auth(adminToken))
          .expect(400);
        expect(res.body.message).toMatch(/no period has been closed/i);
      } finally {
        // Put the fixture back: other suites read closed periods from this database.
        await prisma.reportingPeriod.update({
          where: { id: olderPeriodId },
          data: { status: 'CLOSED' },
        });
        await prisma.reportingPeriod.update({
          where: { id: newerPeriodId },
          data: { status: 'CLOSED' },
        });
      }
    });
  });

  it('removes a schedule and stops listing it', async () => {
    const list = await request(server)
      .get('/api/v1/report-schedules')
      .set(auth(adminToken))
      .expect(200);
    const schedule = list.body.find((s: { name: string }) => s.name === scheduleNames[1]);

    await request(server)
      .delete(`/api/v1/report-schedules/${schedule.id}`)
      .set(auth(adminToken))
      .expect(200);

    const after = await request(server)
      .get('/api/v1/report-schedules')
      .set(auth(adminToken))
      .expect(200);
    expect(after.body.map((s: { id: string }) => s.id)).not.toContain(schedule.id);
  });
});
