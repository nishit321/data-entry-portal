import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntityStatus, EntityType, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);

const OTP = '123456';

/** Questionnaire template lifecycle over real HTTP: RBAC, publish-immutability, versioning. */
describe('Templates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-tpl-admin@nca.test';
  const opEmail = 'e2e-tpl-op@x.test';
  const licence = 'E2E/TPL';
  const templateName = 'E2E Template';

  let adminToken: string;
  let opToken: string;

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
    await prisma.reportingTemplate.deleteMany({ where: { name: templateName } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, opEmail] } } });
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
        name: 'Tpl Op',
        type: EntityType.MMO,
        status: EntityStatus.ACTIVE,
        licenceNumber: licence,
      },
    });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'T',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    await prisma.user.create({
      data: {
        email: opEmail,
        passwordHash,
        firstName: 'T',
        lastName: 'Op',
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    adminToken = await login(adminEmail);
    opToken = await login(opEmail);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication (401)', async () => {
    await request(server).get('/api/v1/templates').expect(401);
  });

  it('forbids an operator from creating a template (403)', async () => {
    await request(server)
      .post('/api/v1/templates')
      .set(auth(opToken))
      .send({ name: templateName })
      .expect(403);
  });

  it('supports the full lifecycle: create, section, field, publish, immutable, new version', async () => {
    // Create draft
    const created = await request(server)
      .post('/api/v1/templates')
      .set(auth(adminToken))
      .send({ name: templateName, description: 'e2e' })
      .expect(201);
    const id = created.body.id;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.version).toBe(1);

    // Add a section
    const withSection = await request(server)
      .post(`/api/v1/templates/${id}/sections`)
      .set(auth(adminToken))
      .send({
        key: 'general',
        title: 'General',
        applicableEntityTypes: ['MNO', 'MMO'],
        frequency: 'QUARTERLY_AND_ANNUAL',
      })
      .expect(201);
    const sectionId = withSection.body.sections[0].id;

    // Add a field
    const withField = await request(server)
      .post(`/api/v1/templates/${id}/sections/${sectionId}/fields`)
      .set(auth(adminToken))
      .send({
        key: 'operator_name',
        label: 'Name of Operator',
        dataType: 'TEXT',
        isMandatory: true,
      })
      .expect(201);
    expect(withField.body.sections[0].fields).toHaveLength(1);

    // Two numeric fields for a cross-field rule to reference.
    await request(server)
      .post(`/api/v1/templates/${id}/sections/${sectionId}/fields`)
      .set(auth(adminToken))
      .send({ key: 'active', label: 'Active subscribers', dataType: 'INTEGER' })
      .expect(201);
    await request(server)
      .post(`/api/v1/templates/${id}/sections/${sectionId}/fields`)
      .set(auth(adminToken))
      .send({ key: 'registered', label: 'Registered subscribers', dataType: 'INTEGER' })
      .expect(201);

    // A rule that references those real numeric fields is accepted.
    const withRule = await request(server)
      .post(`/api/v1/templates/${id}/rules`)
      .set(auth(adminToken))
      .send({
        type: 'LESS_OR_EQUAL',
        severity: 'HARD',
        label: 'active ≤ registered',
        config: { left: 'active', right: 'registered' },
      })
      .expect(201);
    expect(withRule.body.rules).toHaveLength(1);

    // Editing a rule keeps its operator: `type` is create-only, and the update endpoint takes the
    // body the editor actually sends. (Regression: the editor sent `type` on edit, which
    // forbidNonWhitelisted rejected, so every rule edit failed with a 400.)
    const ruleId = withRule.body.rules[0].id;
    const edited = await request(server)
      .patch(`/api/v1/templates/${id}/rules/${ruleId}`)
      .set(auth(adminToken))
      .send({
        severity: 'SOFT',
        label: 'active should not exceed registered',
        config: { left: 'active', right: 'registered' },
      })
      .expect(200);
    const updatedRule = edited.body.rules.find((r: { id: string }) => r.id === ruleId);
    expect(updatedRule.severity).toBe('SOFT');
    expect(updatedRule.type).toBe('LESS_OR_EQUAL');

    // A rule that references a field which doesn't exist is rejected (integrity guard).
    await request(server)
      .post(`/api/v1/templates/${id}/rules`)
      .set(auth(adminToken))
      .send({
        type: 'LESS_OR_EQUAL',
        severity: 'HARD',
        label: 'bad rule',
        config: { left: 'active', right: 'does_not_exist' },
      })
      .expect(400);

    // Deleting a field a rule depends on is blocked.
    const activeFieldId = withRule.body.sections[0].fields.find(
      (f: { key: string }) => f.key === 'active',
    ).id;
    await request(server)
      .delete(`/api/v1/templates/${id}/sections/${sectionId}/fields/${activeFieldId}`)
      .set(auth(adminToken))
      .expect(400);

    // Operators cannot manage rules
    await request(server)
      .post(`/api/v1/templates/${id}/rules`)
      .set(auth(opToken))
      .send({ type: 'LESS_OR_EQUAL', label: 'x', config: {} })
      .expect(403);

    // Publish
    const published = await request(server)
      .post(`/api/v1/templates/${id}/publish`)
      .set(auth(adminToken))
      .expect(201);
    expect(published.body.status).toBe('PUBLISHED');

    // Published is immutable — editing a section is rejected
    await request(server)
      .patch(`/api/v1/templates/${id}/sections/${sectionId}`)
      .set(auth(adminToken))
      .send({ title: 'Changed' })
      .expect(400);

    // Published is immutable — adding a rule is rejected too
    await request(server)
      .post(`/api/v1/templates/${id}/rules`)
      .set(auth(adminToken))
      .send({ type: 'LESS_OR_EQUAL', label: 'y', config: {} })
      .expect(400);

    // New version clones to a fresh DRAFT v2
    const v2 = await request(server)
      .post(`/api/v1/templates/${id}/new-version`)
      .set(auth(adminToken))
      .expect(201);
    expect(v2.body.status).toBe('DRAFT');
    expect(v2.body.version).toBe(2);
    expect(v2.body.sections[0].fields).toHaveLength(3);
    // Rules are cloned into the new version too
    expect(v2.body.rules).toHaveLength(1);
    expect(v2.body.rules[0].type).toBe('LESS_OR_EQUAL');
  });
});
