import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { EntityStatus, EntityType, Role, SubmissionStatus, TemplateStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** On-demand PDF/Excel exports: real files, and scoped to what the reader may see. */
describe('Exports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-ex-admin@nca.test';
  const opAEmail = 'e2e-ex-a@x.test';
  const opBEmail = 'e2e-ex-b@x.test';
  const emails = [adminEmail, opAEmail, opBEmail];
  const licences = ['E2E/EXA', 'E2E/EXB'];
  const tplName = 'E2E Exports Template';
  const rateLabel = 'E2E exports levy';

  let adminToken: string;
  let opAToken: string;
  let opBToken: string;
  let periodId: string;

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
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { in: licences } } });
    await prisma.levyRate.deleteMany({ where: { label: rateLabel } });
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
        name: 'Export Alpha',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Export Bravo',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    const opA = await prisma.user.create({
      data: {
        email: opAEmail,
        passwordHash,
        firstName: 'A',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    const opB = await prisma.user.create({
      data: {
        email: opBEmail,
        passwordHash,
        firstName: 'B',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entB.id,
      },
    });

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: tplName,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: [
            {
              key: 'financials',
              title: 'Financials',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'ANNUAL',
              fields: {
                create: [
                  {
                    key: 'total_revenue',
                    label: 'Total annual revenue',
                    order: 1,
                    dataType: 'MONETARY',
                    isLevyBasis: true,
                  },
                ],
              },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    const revFieldId = tpl.sections[0].fields[0].id;

    const period = await prisma.reportingPeriod.create({
      data: {
        templateId: tpl.id,
        frequency: 'ANNUAL',
        label: 'FY2028',
        periodStart: new Date('2028-01-01'),
        periodEnd: new Date('2028-12-31'),
        dueDate: new Date('2029-02-28'),
        status: 'CLOSED',
      },
    });
    periodId = period.id;

    for (const [ent, op, revenue, ref] of [
      [entA.id, opA.id, '4000000', 'NCA/SUB/2029/920001'],
      [entB.id, opB.id, '1000000', 'NCA/SUB/2029/920002'],
    ] as const) {
      await prisma.submission.create({
        data: {
          entityId: ent,
          periodId: period.id,
          templateId: tpl.id,
          createdById: op,
          status: SubmissionStatus.APPROVED,
          isLate: false,
          submittedAt: new Date('2029-02-20'),
          referenceNumber: ref,
          values: { create: [{ fieldId: revFieldId, valueText: revenue }] },
        },
      });
    }

    await prisma.levyRate.create({
      data: { ratePercent: 2, effectiveFrom: new Date('2028-01-01'), label: rateLabel },
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

  /** Fetch an export and return the raw bytes plus the response headers. */
  async function download(path: string, token: string, query: Record<string, string> = {}) {
    const res = await request(server)
      .get(path)
      .query(query)
      .set(auth(token))
      .responseType('blob')
      .expect(200);
    return { body: res.body as Buffer, headers: res.headers };
  }

  /** Read an .xlsx buffer back and return every cell value of a sheet as strings. */
  async function readSheet(buffer: Buffer, sheetName: string): Promise<string[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet(sheetName);
    const cells: string[] = [];
    sheet?.eachRow((row) => {
      row.eachCell((cell) => cells.push(String(cell.value ?? '')));
    });
    return cells;
  }

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/exports/levy.xlsx').expect(401);
  });

  it('produces a real compliance workbook with both sheets', async () => {
    const { body, headers } = await download('/api/v1/exports/compliance.xlsx', adminToken);

    // A genuine .xlsx is a zip: the bytes must start with "PK".
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(headers['content-type']).toContain('spreadsheetml.sheet');
    expect(headers['content-disposition']).toContain('compliance-summary');

    const summary = await readSheet(body, 'Summary');
    expect(summary.join(' ')).toContain('Compliance summary');
    expect(summary).toContain('Approval rate');

    const trend = await readSheet(body, 'Filing trend');
    expect(trend.join(' ')).toContain('Filing timeliness by period');
  });

  it('produces a levy workbook carrying the assessment and its total', async () => {
    const { body, headers } = await download('/api/v1/exports/levy.xlsx', adminToken, { periodId });
    expect(headers['content-disposition']).toContain('levy-assessment');

    const cells = await readSheet(body, 'Levy assessment');
    const joined = cells.join(' ');
    expect(joined).toContain('Export Alpha');
    expect(joined).toContain('Export Bravo');
    // 4,000,000 and 1,000,000 at 2% → 80,000 and 20,000; total levy 100,000.
    expect(cells).toContain('80000');
    expect(cells).toContain('100000');
  });

  it('produces a levy PDF', async () => {
    const { body, headers } = await download('/api/v1/exports/levy.pdf', adminToken, { periodId });
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(headers['content-type']).toContain('application/pdf');
    expect(headers['content-disposition']).toContain('.pdf');
  });

  it('scopes an operator export to their own rows only', async () => {
    const { body } = await download('/api/v1/exports/levy.xlsx', opAToken, { periodId });
    const joined = (await readSheet(body, 'Levy assessment')).join(' ');
    expect(joined).toContain('Export Alpha');
    // The other operator must never appear in a scoped download.
    expect(joined).not.toContain('Export Bravo');

    const b = await download('/api/v1/exports/levy.xlsx', opBToken, { periodId });
    const bJoined = (await readSheet(b.body, 'Levy assessment')).join(' ');
    expect(bJoined).toContain('Export Bravo');
    expect(bJoined).not.toContain('Export Alpha');
  });
});
