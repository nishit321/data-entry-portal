import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(120000);

const OTP = '123456';
const PASSWORD = 'Passw0rd!23';

/**
 * Does every overnight job the server runs have a name on screen?
 *
 * The System health page lists what the scheduler runs and offers a "Run now" beside each. It had
 * copy for three of the seven. The other four still arrived — the API returns whatever the
 * scheduler registers — so an administrator saw four rows with **no title, no explanation, and a
 * button**. Nothing in either project objected: the server was right, the page was right about the
 * jobs it knew, and its list of job names was simply out of date.
 *
 * TypeScript could not catch it, because those names come off the wire and are only as true as the
 * hand-written union says they are. So this compares the two directly: what the running server
 * reports, against what the frontend declares and writes copy for. It is deliberately in the
 * backend suite, where the running scheduler is, and reads the frontend as text.
 */
describe('scheduled jobs are all named on screen (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;
  let adminToken: string;

  const EMAIL = 'jobs-admin@x.test';

  async function cleanup() {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();
    await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        firstName: 'Jobs',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    adminToken = res.body.accessToken
      ? res.body.accessToken
      : (
          await request(server)
            .post('/api/v1/auth/verify-otp')
            .send({ challengeId: res.body.challengeId, code: OTP })
        ).body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  /** The frontend read as text, since this suite cannot import across the two projects. */
  const frontend = (relative: string) =>
    readFileSync(join(__dirname, '..', '..', 'frontend', 'src', relative), 'utf8');

  it('reads a frontend that is really there', () => {
    // A check that silently found nothing would pass for ever and mean nothing.
    expect(frontend('lib/system.api.ts')).toContain('JobStatus');
    expect(frontend('pages/SystemPage.tsx')).toContain('JOB_LABELS');
  });

  it('gives every job the server runs a name and an explanation on screen', async () => {
    const res = await request(server)
      .get('/api/v1/scheduler/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const names = (res.body.jobs as { name: string }[]).map((j) => j.name);
    expect(names.length).toBeGreaterThan(3);

    const api = frontend('lib/system.api.ts');
    const page = frontend('pages/SystemPage.tsx');
    const labels = page.slice(page.indexOf('JOB_LABELS'), page.indexOf('JOB_DESCRIPTIONS'));
    const descriptions = page.slice(page.indexOf('JOB_DESCRIPTIONS'));

    const missing = names.flatMap((name) => {
      const gaps: string[] = [];
      if (!api.includes(`'${name}'`)) gaps.push(`${name}: not in JobStatus['name']`);
      if (!labels.includes(`'${name}'`)) gaps.push(`${name}: no entry in JOB_LABELS`);
      if (!descriptions.includes(`'${name}'`)) gaps.push(`${name}: no entry in JOB_DESCRIPTIONS`);
      return gaps;
    });

    if (missing.length > 0) {
      throw new Error(
        'The scheduler runs these and the System health page cannot name them, so an ' +
          'administrator sees a "Run now" button beside a blank line:\n  ' +
          missing.join('\n  '),
      );
    }
  });

  it('does not name jobs the server no longer runs', async () => {
    /*
     * The other direction. A job removed from the scheduler leaves its copy behind, and the next
     * person to read that file believes the portal does something it stopped doing — which is the
     * quieter of the two failures and the harder one to notice.
     */
    const res = await request(server)
      .get('/api/v1/scheduler/status')
      .set('Authorization', `Bearer ${adminToken}`);
    const names = new Set((res.body.jobs as { name: string }[]).map((j) => j.name));

    const page = frontend('pages/SystemPage.tsx');
    const labels = page.slice(page.indexOf('JOB_LABELS'), page.indexOf('JOB_DESCRIPTIONS'));
    const declared = [...labels.matchAll(/'([a-z-]+)':/g)].map((m) => m[1]!);

    expect(declared.filter((name) => !names.has(name))).toEqual([]);
  });
});
