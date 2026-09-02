import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EntityStatus,
  EntityType,
  FieldType,
  ReferenceCategory,
  ReviewStage,
  Role,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(60000);
const OTP = '123456';

/**
 * Service-gated sections (VALIDATION_SPEC §3, §6.1) and the fast-track condition that depends on
 * them (Q2).
 *
 * The questionnaire here is the shape the spec describes: Section 1 asks which services the
 * operator offers, and a mobile-money section exists only for operators who tick that service.
 */
describe('Service-gated sections (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-svc-admin@nca.test';
  const opEmail = 'e2e-svc-op@x.test';
  const emails = [adminEmail, opEmail];
  const licence = 'E2E/SVC/A';
  const tplName = 'E2E Service Template';

  let opToken: string;
  let entityId: string;
  const periods: string[] = [];
  const fieldIds: Record<string, string> = {};

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
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: licence } } },
    });
    await prisma.submission.deleteMany({ where: { entity: { licenceNumber: licence } } });
    await prisma.enforcementCase.deleteMany({ where: { entity: { licenceNumber: licence } } });
    await prisma.complianceStreak.deleteMany({ where: { entity: { licenceNumber: licence } } });
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
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NCA',
        role: Role.ADMIN,
      },
    });
    const entity = await prisma.entity.create({
      data: {
        name: 'Service Op',
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    entityId = entity.id;
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
              fields: {
                create: [
                  {
                    key: 'svc_services',
                    label: 'Services offered',
                    order: 1,
                    dataType: FieldType.REFERENCE,
                    referenceCategory: ReferenceCategory.SERVICE_TYPE,
                    isMandatory: true,
                  },
                ],
              },
            },
            {
              key: 'mobile_money',
              title: 'Mobile money',
              order: 2,
              applicableEntityTypes: [EntityType.MNO],
              // Exists only for operators who tick mobile money.
              requiredServiceCode: 'MOBILE_MONEY',
              fields: {
                create: [
                  {
                    key: 'svc_float',
                    label: 'Float balance',
                    order: 1,
                    dataType: FieldType.MONETARY,
                    isMandatory: true,
                  },
                ],
              },
            },
          ],
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    for (const section of tpl.sections) {
      for (const field of section.fields) fieldIds[field.key] = field.id;
    }

    // Five periods: enough to build a streak of three and then break it.
    for (let i = 1; i <= 5; i++) {
      const period = await prisma.reportingPeriod.create({
        data: {
          templateId: tpl.id,
          frequency: 'QUARTERLY',
          label: `2026 Q${i} services`,
          periodStart: new Date(Date.UTC(2026, (i - 1) * 3, 1)),
          periodEnd: new Date(Date.UTC(2026, i * 3, 0)),
          // Well in the future, so nothing is late and no sweep touches these fixtures.
          dueDate: new Date(Date.UTC(2999, i, 15)),
          status: 'OPEN',
          openedAt: new Date(),
        },
      });
      periods.push(period.id);
    }

    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Open a draft and put the given answers into it. */
  async function fill(periodId: string, answers: Record<string, string>) {
    const draft = await request(server)
      .post('/api/v1/submissions')
      .set(auth(opToken))
      .send({ periodId })
      .expect(201);

    await request(server)
      .put(`/api/v1/submissions/${draft.body.id}/values`)
      .set(auth(opToken))
      .send({
        values: Object.entries(answers).map(([key, valueText]) => ({
          fieldId: fieldIds[key],
          valueText,
        })),
      })
      .expect(200);

    return draft.body.id as string;
  }

  const check = (id: string) =>
    request(server).post(`/api/v1/submissions/${id}/validate`).set(auth(opToken)).expect(201);

  describe('a section for a service the operator does not offer', () => {
    it('is not required, so the return validates without it', async () => {
      const id = await fill(periods[0], { svc_services: 'VOICE' });
      const res = await check(id);
      // The mobile-money section is mandatory *within itself*, and must not be demanded here.
      expect(res.body.hard.some((i: { fieldKey: string }) => i.fieldKey === 'svc_float')).toBe(
        false,
      );
      expect(res.body.hard).toEqual([]);
    });

    it('is a hard error to answer it anyway', async () => {
      const id = await fill(periods[1], { svc_services: 'VOICE', svc_float: '5000' });
      const res = await check(id);
      const issue = res.body.hard.find((i: { code: string }) => i.code === 'service_not_declared');
      expect(issue).toBeDefined();
      expect(issue.fieldKey).toBe('svc_float');
      expect(issue.label).toBe('Float balance');
      expect(issue.message).toContain('mobile money');
    });

    it('refuses the submission while that stands', async () => {
      const list = await request(server)
        .get('/api/v1/submissions')
        .query({ periodId: periods[1] })
        .set(auth(opToken))
        .expect(200);
      const id = list.body.data[0].id;

      const res = await request(server)
        .post(`/api/v1/submissions/${id}/submit`)
        .set(auth(opToken))
        .send({ signedName: 'Op User' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('mobile money');
    });

    it('accepts it once the answer is cleared', async () => {
      const list = await request(server)
        .get('/api/v1/submissions')
        .query({ periodId: periods[1] })
        .set(auth(opToken))
        .expect(200);
      const id = list.body.data[0].id;

      // Saving is a patch by inclusion: a field that is sent with no value is cleared, a field
      // that is not sent at all is left alone. The editor always sends every field it is showing,
      // so this is what "Clear this section" does on the wire.
      await request(server)
        .put(`/api/v1/submissions/${id}/values`)
        .set(auth(opToken))
        .send({
          values: [
            { fieldId: fieldIds.svc_services, valueText: 'VOICE' },
            { fieldId: fieldIds.svc_float },
          ],
        })
        .expect(200);

      const res = await check(id);
      expect(res.body.hard).toEqual([]);

      // And the figure really is gone, not merely hidden.
      const cleared = await prisma.submissionValue.findFirst({
        where: { submissionId: id, fieldId: fieldIds.svc_float },
        select: { valueText: true },
      });
      expect(cleared?.valueText ?? null).toBeNull();
    });
  });

  describe('a section for a service the operator does offer', () => {
    it('becomes required once the service is ticked', async () => {
      const id = await fill(periods[2], { svc_services: 'MOBILE_MONEY' });
      const res = await check(id);
      const missing = res.body.hard.find((i: { fieldKey: string }) => i.fieldKey === 'svc_float');
      expect(missing).toBeDefined();
      expect(missing.code).toBe('required');
    });

    it('validates once it is filled in', async () => {
      const list = await request(server)
        .get('/api/v1/submissions')
        .query({ periodId: periods[2] })
        .set(auth(opToken))
        .expect(200);
      const id = list.body.data[0].id;

      await request(server)
        .put(`/api/v1/submissions/${id}/values`)
        .set(auth(opToken))
        .send({
          values: [
            { fieldId: fieldIds.svc_services, valueText: 'MOBILE_MONEY' },
            { fieldId: fieldIds.svc_float, valueText: '5000' },
          ],
        })
        .expect(200);

      const res = await check(id);
      expect(res.body.hard).toEqual([]);
    });

    it('reads a service out of a multi-value answer', async () => {
      const id = await fill(periods[3], {
        svc_services: 'VOICE, MOBILE_MONEY',
        svc_float: '7000',
      });
      const res = await check(id);
      expect(res.body.hard).toEqual([]);
    });
  });

  describe('fast-track after a change in reported services (Q2)', () => {
    /** File a return for a period, with the given services, and take it to approval. */
    async function fileAndApprove(periodId: string, answers: Record<string, string>) {
      const id = await fill(periodId, answers);
      await request(server)
        .post(`/api/v1/submissions/${id}/submit`)
        .set(auth(opToken))
        .send({ signedName: 'Op User' })
        .expect(201);
      return id;
    }

    it('does not fast-track the first return after the service mix changes', async () => {
      // Build a clean streak of three on one service mix.
      await prisma.complianceStreak.upsert({
        where: { entityId_templateName: { entityId, templateName: tplName } },
        create: { entityId, templateName: tplName, count: 3 },
        update: { count: 3 },
      });

      // A return on the *same* mix as the last filed one fast-tracks: straight to the Verifier.
      const same = await fileAndApprove(periods[3], {
        svc_services: 'VOICE, MOBILE_MONEY',
        svc_float: '7000',
      });
      const sameRow = await prisma.submission.findUnique({
        where: { id: same },
        select: { reviewStage: true },
      });
      expect(sameRow!.reviewStage).toBe(ReviewStage.VERIFIER);

      // Now the operator drops a service. The next return goes to the Checker despite the streak.
      await prisma.complianceStreak.update({
        where: { entityId_templateName: { entityId, templateName: tplName } },
        data: { count: 3 },
      });
      const changed = await fileAndApprove(periods[4], { svc_services: 'VOICE' });
      const changedRow = await prisma.submission.findUnique({
        where: { id: changed },
        select: { reviewStage: true },
      });
      expect(changedRow!.reviewStage).toBe(ReviewStage.CHECKER);
    });

    it('resets the streak, so the return after that does not fast-track either', async () => {
      const streak = await prisma.complianceStreak.findUnique({
        where: { entityId_templateName: { entityId, templateName: tplName } },
        select: { count: true },
      });
      expect(streak!.count).toBe(0);
    });
  });
});
