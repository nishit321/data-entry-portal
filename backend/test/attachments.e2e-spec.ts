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

const KML = Buffer.from(
  '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>',
);
const CSV = Buffer.from('agent,region\nJuba Telecom,Central Equatoria\n');

/** Attachment upload / list / download / delete over real HTTP, with segregation and draft-lock. */
describe('Attachments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const emails = ['e2e-att-a@x.test', 'e2e-att-b@x.test', 'e2e-att-checker@nca.test'];
  const licences = ['E2E/ATTA', 'E2E/ATTB'];
  const tplName = 'E2E Attachment Template';

  let opAToken: string;
  let opBToken: string;
  let checkerToken: string;
  let templateId: string;
  let nameFieldId: string;
  let subsFieldId: string;
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
        name: 'Att A',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[0],
      },
    });
    const entB = await prisma.entity.create({
      data: {
        name: 'Att B',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licences[1],
      },
    });
    await prisma.user.create({
      data: {
        email: emails[0],
        passwordHash,
        firstName: 'A',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entA.id,
      },
    });
    await prisma.user.create({
      data: {
        email: emails[1],
        passwordHash,
        firstName: 'B',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entB.id,
      },
    });
    await prisma.user.create({
      data: {
        email: emails[2],
        passwordHash,
        firstName: 'Checker',
        lastName: 'NCA',
        role: Role.CHECKER,
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
                  { key: 'op_name', label: 'Name', order: 1, dataType: 'TEXT', isMandatory: true },
                  {
                    key: 'subs',
                    label: 'Subscribers',
                    order: 2,
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
    templateId = tpl.id;
    nameFieldId = tpl.sections[0].fields.find((f) => f.key === 'op_name')!.id;
    subsFieldId = tpl.sections[0].fields.find((f) => f.key === 'subs')!.id;

    opAToken = await login(emails[0]);
    opBToken = await login(emails[1]);
    checkerToken = await login(emails[2]);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // A fresh period per call so each test gets a clean draft (one draft exists per entity+period).
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

  it('requires authentication (401)', async () => {
    await request(server)
      .get('/api/v1/submissions/00000000-0000-0000-0000-000000000000/attachments')
      .expect(401);
  });

  it('uploads, lists, and downloads an attachment on a draft', async () => {
    const id = await newDraft(opAToken);

    const uploaded = await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(201);
    expect(uploaded.body.fileName).toBe('coverage.kml');
    expect(uploaded.body.kind).toBe('COVERAGE_MAP');
    // The internal storage key must never leak to the client.
    expect(uploaded.body.storageKey).toBeUndefined();
    const attId = uploaded.body.id;

    const list = await request(server)
      .get(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .expect(200);
    expect(list.body.some((a: { id: string }) => a.id === attId)).toBe(true);

    const download = await request(server)
      .get(`/api/v1/submissions/${id}/attachments/${attId}/download`)
      .set(auth(opAToken))
      .responseType('blob')
      .expect(200);
    expect(download.headers['content-disposition']).toContain('coverage.kml');
    expect((download.body as Buffer).toString('utf8')).toContain('<kml');

    // The attachment also travels with the submission detail payload.
    const detail = await request(server)
      .get(`/api/v1/submissions/${id}`)
      .set(auth(opAToken))
      .expect(200);
    expect(detail.body.attachments.some((a: { id: string }) => a.id === attId)).toBe(true);
  });

  it('rejects a file whose content does not match its declared kind (400)', async () => {
    const id = await newDraft(opBToken);
    await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opBToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', CSV, 'agents.csv')
      .expect(400);
  });

  it('keeps attachments segregated between operators (403)', async () => {
    const id = await newDraft(opAToken);
    const uploaded = await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(201);

    await request(server)
      .get(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opBToken))
      .expect(403);
    await request(server)
      .get(`/api/v1/submissions/${id}/attachments/${uploaded.body.id}/download`)
      .set(auth(opBToken))
      .expect(403);
    await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opBToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(403);
  });

  it('soft-deletes an attachment and drops it from the list', async () => {
    const id = await newDraft(opAToken);
    const uploaded = await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(201);

    await request(server)
      .delete(`/api/v1/submissions/${id}/attachments/${uploaded.body.id}`)
      .set(auth(opAToken))
      .expect(200);

    const list = await request(server)
      .get(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .expect(200);
    expect(list.body.some((a: { id: string }) => a.id === uploaded.body.id)).toBe(false);
  });

  it('locks attachments once the return is submitted (400)', async () => {
    const id = await newDraft(opAToken);
    const uploaded = await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(201);

    await request(server)
      .put(`/api/v1/submissions/${id}/values`)
      .set(auth(opAToken))
      .send({
        values: [
          { fieldId: nameFieldId, valueText: 'Demo' },
          { fieldId: subsFieldId, valueText: '10' },
        ],
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opAToken))
      .send({ signedName: 'A Op' })
      .expect(201);

    // No new uploads and no deletions once it is out of draft.
    await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(400);
    await request(server)
      .delete(`/api/v1/submissions/${id}/attachments/${uploaded.body.id}`)
      .set(auth(opAToken))
      .expect(400);

    // But the Authority can still read the attachments on a submitted return.
    const list = await request(server)
      .get(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .expect(200);
    expect(list.body.length).toBe(1);
  });

  it('carries attachments forward when a rejected return is revised', async () => {
    // Upload, fill, submit.
    const id = await newDraft(opAToken);
    await request(server)
      .post(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .field('kind', 'COVERAGE_MAP')
      .attach('file', KML, 'coverage.kml')
      .expect(201);
    await request(server)
      .put(`/api/v1/submissions/${id}/values`)
      .set(auth(opAToken))
      .send({
        values: [
          { fieldId: nameFieldId, valueText: 'Demo' },
          { fieldId: subsFieldId, valueText: '10' },
        ],
      })
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${id}/submit`)
      .set(auth(opAToken))
      .send({ signedName: 'A Op' })
      .expect(201);

    // Checker rejects with a reason.
    await request(server)
      .post(`/api/v1/workflow/${id}/decision`)
      .set(auth(checkerToken))
      .send({ decision: 'REJECT', comment: 'Please attach the updated coverage map' })
      .expect(201);

    // Operator revises → a fresh draft that carries the file forward.
    const revised = await request(server)
      .post(`/api/v1/submissions/${id}/revise`)
      .set(auth(opAToken))
      .expect(201);
    const newId = revised.body.id;
    expect(newId).not.toBe(id);

    const carried = revised.body.attachments;
    expect(carried).toHaveLength(1);
    expect(carried[0].fileName).toBe('coverage.kml');
    // It is a fresh, independent attachment row on the new version (its own id + blob).
    expect(carried[0].submissionId).toBe(newId);

    // The carried file is downloadable on the new draft, and removable (it is an editable draft).
    const download = await request(server)
      .get(`/api/v1/submissions/${newId}/attachments/${carried[0].id}/download`)
      .set(auth(opAToken))
      .responseType('blob')
      .expect(200);
    expect((download.body as Buffer).toString('utf8')).toContain('<kml');

    await request(server)
      .delete(`/api/v1/submissions/${newId}/attachments/${carried[0].id}`)
      .set(auth(opAToken))
      .expect(200);

    // Removing it from the revision leaves the rejected version's own copy untouched (history).
    const original = await request(server)
      .get(`/api/v1/submissions/${id}/attachments`)
      .set(auth(opAToken))
      .expect(200);
    expect(original.body.length).toBe(1);
  });
});
