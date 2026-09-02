import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  ReportFrequency,
  Role,
  ScheduledReportKind,
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

  const createSchedule = (body: Record<string, unknown>, expected = 201) =>
    request(server)
      .post('/api/v1/report-schedules')
      .set(auth(adminToken))
      .send(body)
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
