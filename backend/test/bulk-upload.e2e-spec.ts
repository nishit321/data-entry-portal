import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { EntityStatus, EntityType, Role, TemplateStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/** Filling a return from a workbook: download, fill offline, upload, and retry safely. */
describe('Bulk upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const opAEmail = 'e2e-bulk-a@x.test';
  const opBEmail = 'e2e-bulk-b@x.test';
  const emails = [opAEmail, opBEmail];
  const licences = ['E2E/BULKA', 'E2E/BULKB'];
  const tplName = 'E2E Bulk Template';

  let opAToken: string;
  let opBToken: string;
  let templateId: string;
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
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: { in: licences } } } });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: tplName } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: tplName } });
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
    const entA = await prisma.entity.create({
      data: {
        name: 'Bulk A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Bulk B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    await prisma.user.create({
      data: {
        email: opAEmail,
        passwordHash,
        firstName: 'A',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    await prisma.user.create({
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
              key: 'general',
              title: 'General',
              order: 1,
              applicableEntityTypes: [EntityType.MNO],
              frequency: 'QUARTERLY_AND_ANNUAL',
              fields: {
                create: [
                  {
                    key: 'op_name',
                    label: 'Operator name',
                    order: 1,
                    dataType: 'TEXT',
                    isMandatory: true,
                  },
                  {
                    key: 'subs',
                    label: 'Subscribers',
                    order: 2,
                    dataType: 'INTEGER',
                    isMandatory: true,
                    flowOrStock: 'STOCK',
                  },
                  {
                    key: 'active',
                    label: 'Active subscribers',
                    order: 3,
                    dataType: 'INTEGER',
                    flowOrStock: 'STOCK',
                  },
                ],
              },
            },
          ],
        },
      },
    });
    templateId = tpl.id;

    opAToken = await login(opAEmail);
    opBToken = await login(opBEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A fresh period per call, so each test gets its own clean draft. */
  async function newDraft(token: string): Promise<string> {
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
      .set(auth(token))
      .send({ periodId: period.id })
      .expect(201);
    return draft.body.id as string;
  }

  const downloadWorkbook = async (id: string, token: string): Promise<Buffer> => {
    const res = await request(server)
      .get(`/api/v1/submissions/${id}/workbook`)
      .set(auth(token))
      .responseType('blob')
      .expect(200);
    return res.body as Buffer;
  };

  /** Fill the Value column of a downloaded workbook, as an operator would offline. */
  async function fill(buffer: Buffer, values: Record<string, string>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 6) return;
      const key = String(row.getCell(2).value ?? '');
      if (values[key] !== undefined) row.getCell(4).value = values[key];
    });
    return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  }

  const upload = (id: string, token: string, file: Buffer, name = 'return.xlsx') =>
    request(server)
      .post(`/api/v1/submissions/${id}/workbook`)
      .set(auth(token))
      .attach('file', file, name);

  it('requires authentication (401)', async () => {
    await request(server)
      .get('/api/v1/submissions/00000000-0000-0000-0000-000000000000/workbook')
      .expect(401);
  });

  it('downloads a workbook carrying a row per question', async () => {
    const id = await newDraft(opAToken);
    const buffer = await downloadWorkbook(id, opAToken);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const keys: string[] = [];
    sheet.eachRow((row, n) => {
      if (n > 6) keys.push(String(row.getCell(2).value ?? ''));
    });
    expect(keys).toEqual(['op_name', 'subs', 'active']);
  });

  it('loads a filled workbook into the draft and reports what it did', async () => {
    const id = await newDraft(opAToken);
    const filled = await fill(await downloadWorkbook(id, opAToken), {
      op_name: 'Acme Telecom',
      subs: '1000',
      active: '900',
    });

    const res = await upload(id, opAToken, filled).expect(201);
    expect(res.body.applied).toBe(3);
    expect(res.body.rejected).toEqual([]);
    // The saved values come back through the ordinary validation engine.
    expect(res.body.validation.hard).toEqual([]);

    const detail = await request(server)
      .get(`/api/v1/submissions/${id}`)
      .set(auth(opAToken))
      .expect(200);
    expect(detail.body.values).toHaveLength(3);
  });

  it('is safe to upload the same file twice', async () => {
    const id = await newDraft(opAToken);
    const filled = await fill(await downloadWorkbook(id, opAToken), {
      op_name: 'Acme Telecom',
      subs: '1000',
    });

    await upload(id, opAToken, filled).expect(201);
    const second = await upload(id, opAToken, filled).expect(201);
    expect(second.body.applied).toBe(2);

    // The upsert is keyed on (submission, field), so a retry converges rather than duplicating.
    const detail = await request(server)
      .get(`/api/v1/submissions/${id}`)
      .set(auth(opAToken))
      .expect(200);
    expect(detail.body.values).toHaveLength(2);
  });

  it('reports an unknown field key without losing the good rows', async () => {
    const id = await newDraft(opAToken);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await downloadWorkbook(id, opAToken)) as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    sheet.eachRow((row, n) => {
      if (n === 7) row.getCell(4).value = 'Acme Telecom';
    });
    sheet.addRow(['General', 'not_a_field', 'Made up', 'something']);
    const filled = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    const res = await upload(id, opAToken, filled).expect(201);
    expect(res.body.applied).toBe(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].key).toBe('not_a_field');
    expect(res.body.rejected[0].reason).toMatch(/does not match any question/i);
  });

  it('surfaces validation issues from the uploaded answers', async () => {
    const id = await newDraft(opAToken);
    const filled = await fill(await downloadWorkbook(id, opAToken), {
      op_name: 'Acme',
      subs: 'not a number',
    });
    const res = await upload(id, opAToken, filled).expect(201);
    expect(res.body.applied).toBe(2);
    // The engine flags the bad figure straight away rather than at submit.
    expect(res.body.validation.hard.length).toBeGreaterThan(0);
  });

  it('rejects a file that is not a workbook, and one with nothing in it', async () => {
    const id = await newDraft(opAToken);
    await upload(id, opAToken, Buffer.from('just some text'), 'notes.txt').expect(400);
    // A downloaded but unfilled workbook has no answers to load.
    await upload(id, opAToken, await downloadWorkbook(id, opAToken)).expect(400);
  });

  it('keeps one operator out of another workbook', async () => {
    const id = await newDraft(opAToken);
    await request(server).get(`/api/v1/submissions/${id}/workbook`).set(auth(opBToken)).expect(403);
    await upload(id, opBToken, await downloadWorkbook(id, opAToken)).expect(403);
  });

  it('refuses to load into a return that is no longer a draft', async () => {
    const id = await newDraft(opAToken);
    const filled = await fill(await downloadWorkbook(id, opAToken), {
      op_name: 'Acme Telecom',
      subs: '1000',
    });
    await upload(id, opAToken, filled).expect(201);
    await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opAToken))
      .send({ signedName: 'A Op' })
      .expect(201);

    await upload(id, opAToken, filled).expect(400);
  });
});
