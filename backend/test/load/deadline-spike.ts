/* eslint-disable no-console -- this harness is a reporting tool; printing the numbers is its whole purpose */
/**
 * Deadline-day load harness (Q11, §9).
 *
 * Q11 says to expect a submission spike around each deadline and §9 says to design the submission
 * endpoints for that burst. Both were done from first principles; this measures whether they hold.
 *
 * It drives the **real** API through the real guard chain — no mocks, no shortcuts — with the
 * workload a deadline day actually produces: every operator opens its return at once, types into it
 * for a while with autosave firing, runs the validator a few times, and files. That shape matters.
 * Hammering one URL would measure something nobody does.
 *
 * Run it against the test database only:
 *   npm run load:spike
 *
 * It is deliberately not a test. It has no assertions and it is not in the e2e run: a timing
 * measurement that fails a build on a slow laptop teaches nobody anything. It prints numbers, and a
 * person decides what they mean.
 *
 * Two things about the instrument, because a number is only worth as much as how it was taken:
 *
 * - The server **listens on a real port** and is driven over real sockets with keep-alive. Supertest
 *   starts an ephemeral listener per request when the server is not already listening, and two dozen
 *   concurrent requests then race on that rather than on anything in the application. The first
 *   version of this harness did exactly that and produced connection resets that had nothing to do
 *   with the portal.
 * - The load generator shares a process with the server, so they compete for one event loop and one
 *   CPU. That inflates every figure, and inflates the CPU-bound ones most. Treat the numbers as a
 *   pessimistic floor and the *shape* — which operation dominates — as the real finding.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Agent, request as httpRequest } from 'http';
import type { AddressInfo } from 'net';
import { EntityStatus, EntityType, FieldType, Role, TemplateStatus } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/app.setup';
import { hashPassword } from '../../src/common/utils/password.util';

// --- The shape of the day, all overridable from the environment ---------------

/** Q11's working assumption: ~3 MNOs and ~20 ISPs, all filing on the same afternoon. */
const OPERATORS = Number(process.env.LOAD_OPERATORS ?? 23);
/** A real NCA questionnaire is long. This is the order of magnitude, not a guess at the total. */
const FIELDS = Number(process.env.LOAD_FIELDS ?? 120);
/** Autosave fires every 2s while someone is typing; a 10-minute sitting is ~300 saves, so this is gentle. */
const SAVES_PER_OPERATOR = Number(process.env.LOAD_SAVES ?? 15);
/** How many operators are actually mid-request at the same moment. */
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 23);

const PASSWORD = 'Passw0rd!23';
const OTP = '123456';
const TAG = 'LOADTEST';
/** The editor's autosave debounce, mirrored from `frontend/src/hooks/useAutosave.ts`. */
const AUTOSAVE_DEBOUNCE_SEC = 2;

interface Sample {
  op: string;
  ms: number;
  ok: boolean;
  /** Which simulated operator made it, for the per-operator rate below. */
  who?: string;
}

/** One connection pool for the whole run, as a browser or an integration would have. */
const agent = new Agent({ keepAlive: true, maxSockets: 256 });

let baseUrl = '';

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** A plain HTTP call against the listening server. */
function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Reply> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const url = new URL(path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        agent,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          accept: 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try {
            body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          } catch {
            body = { raw: text.slice(0, 200) };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Call and insist on a status, so a silent 4xx cannot masquerade as a fast response. */
async function expect(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  status: number,
  options: { token?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const reply = await call(method, path, options);
  if (reply.status !== status) {
    throw new Error(
      `${method} ${path} answered ${reply.status}, expected ${status}: ${JSON.stringify(
        reply.body,
      ).slice(0, 300)}`,
    );
  }
  return reply.body;
}

const samples: Sample[] = [];

async function timed<T>(op: string, run: () => Promise<T>, who?: string): Promise<T> {
  const started = process.hrtime.bigint();
  try {
    const result = await run();
    samples.push({ op, ms: Number(process.hrtime.bigint() - started) / 1e6, ok: true, who });
    return result;
  } catch (error) {
    samples.push({ op, ms: Number(process.hrtime.bigint() - started) / 1e6, ok: false, who });
    throw error;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function report() {
  const byOp = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = byOp.get(s.op) ?? [];
    list.push(s);
    byOp.set(s.op, list);
  }

  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (n: number) => n.toFixed(0).padStart(7);

  console.log('');
  console.log(
    `${pad('operation', 22)}${pad('calls', 8)}${pad('fail', 7)}${'p50'.padStart(7)}${'p95'.padStart(8)}${'p99'.padStart(8)}${'max'.padStart(8)}   (ms)`,
  );
  console.log('-'.repeat(80));

  for (const [op, list] of [...byOp.entries()].sort()) {
    const ok = list
      .filter((s) => s.ok)
      .map((s) => s.ms)
      .sort((a, b) => a - b);
    const failed = list.length - ok.length;
    console.log(
      pad(op, 22) +
        pad(String(list.length), 8) +
        pad(String(failed), 7) +
        num(percentile(ok, 50)) +
        num(percentile(ok, 95)) +
        num(percentile(ok, 99)) +
        num(ok[ok.length - 1] ?? 0),
    );
  }
  console.log('');
}

/**
 * How chattily one operator talks to the portal, against the rate limit that is configured.
 *
 * Worth measuring rather than assuming, because the limit is applied **per IP address**, and an
 * operator's staff all sit behind one office connection. Their budgets are shared whether or not
 * anybody intended that.
 *
 * The harness types with no pauses at all, so its rate is an upper bound on any one person. The
 * realistic figure is set by the autosave debounce: one save every two seconds is 30 requests a
 * minute per person, whatever they are typing.
 */
function rateReport(elapsedSec: number) {
  const perOperator = new Map<string, number>();
  for (const s of samples) {
    if (!s.who) continue;
    perOperator.set(s.who, (perOperator.get(s.who) ?? 0) + 1);
  }
  const counts = [...perOperator.values()];
  if (counts.length === 0) return;

  const busiest = Math.max(...counts);
  const observedPerMin = (busiest / elapsedSec) * 60;
  const realisticPerMin = 60 / (AUTOSAVE_DEBOUNCE_SEC || 2);
  const limit = Number(process.env.THROTTLE_LIMIT ?? 100);
  const ttl = Number(process.env.THROTTLE_TTL_SEC ?? 60);
  const limitPerMin = (limit / ttl) * 60;

  console.log('Rate against the configured limit');
  console.log('-'.repeat(80));
  console.log(`  configured                ${limitPerMin.toFixed(0)} requests/min, per IP address`);
  console.log(
    `  this harness, per operator ${observedPerMin.toFixed(0)} requests/min (no pauses; an upper bound)`,
  );
  console.log(
    `  one person typing steadily ${realisticPerMin.toFixed(0)} requests/min (autosave every ${AUTOSAVE_DEBOUNCE_SEC}s)`,
  );
  // Autosave carries its own, larger budget for exactly this reason; see the comment on the route.
  const autosaveLimitPerMin = 600;
  console.log(
    `  on the global limit, staff sharing one office connection would reach it at ${Math.floor(
      limitPerMin / realisticPerMin,
    )} people typing at once.`,
  );
  console.log(
    `  autosave carries its own budget of ${autosaveLimitPerMin}/min, so it takes ${Math.floor(
      autosaveLimitPerMin / realisticPerMin,
    )} people typing at once.`,
  );
  console.log('');
}

/** Run `tasks` with at most `limit` in flight, so concurrency is the thing being controlled. */
async function pool<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:root@localhost:5432/nca_portal_test?schema=public';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'load-test-secret-string-1234567890';
  process.env.SENDGRID_API_KEY = '';
  // The throttler is skipped under NODE_ENV=test. That is right for this harness: what is being
  // measured is how the database and the request pipeline behave under the burst, and a rate limit
  // would simply cap the load before any of that showed. Whether the *limit* is set correctly for
  // a deadline day is a separate question, answered from these numbers rather than by them.

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  configureApp(app);
  // A real socket on a real port. See the note at the top of the file for why this matters.
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  const prisma = app.get(PrismaService);

  console.log(
    `Deadline spike: ${OPERATORS} operators, ${FIELDS} questions, ${SAVES_PER_OPERATOR} autosaves each, ${CONCURRENCY} at a time.`,
  );

  // --- Clean up anything a previous run left behind --------------------------
  const cleanup = async () => {
    await prisma.submissionValue.deleteMany({
      where: { submission: { entity: { licenceNumber: { startsWith: TAG } } } },
    });
    await prisma.submission.deleteMany({
      where: { entity: { licenceNumber: { startsWith: TAG } } },
    });
    await prisma.enforcementCase.deleteMany({
      where: { entity: { licenceNumber: { startsWith: TAG } } },
    });
    await prisma.complianceStreak.deleteMany({
      where: { entity: { licenceNumber: { startsWith: TAG } } },
    });
    await prisma.reportingPeriod.deleteMany({ where: { template: { name: TAG } } });
    await prisma.reportingTemplate.deleteMany({ where: { name: TAG } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@loadtest.invalid' } } });
    await prisma.entity.deleteMany({ where: { licenceNumber: { startsWith: TAG } } });
  };
  await cleanup();

  // --- Seed the day ----------------------------------------------------------
  const passwordHash = await hashPassword(PASSWORD);

  const template = await prisma.reportingTemplate.create({
    data: {
      name: TAG,
      version: 1,
      status: TemplateStatus.PUBLISHED,
      publishedAt: new Date(),
      sections: {
        create: {
          key: 'load',
          title: 'Load section',
          order: 1,
          applicableEntityTypes: [EntityType.MNO, EntityType.ISP],
          fields: {
            create: Array.from({ length: FIELDS }, (_, i) => ({
              key: `load_q${i}`,
              label: `Question ${i}`,
              order: i,
              dataType: FieldType.INTEGER,
              // Not mandatory: the point is to measure the machinery, not to fight validation.
              isMandatory: false,
            })),
          },
        },
      },
    },
    include: { sections: { include: { fields: true } } },
  });
  const fieldIds = template.sections[0].fields.map((f) => f.id);

  const period = await prisma.reportingPeriod.create({
    data: {
      templateId: template.id,
      frequency: 'QUARTERLY',
      label: 'Load period',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-03-31'),
      // Far in the future, so nothing is late and no sweep touches these fixtures.
      dueDate: new Date('2999-04-15'),
      status: 'OPEN',
      openedAt: new Date(),
    },
  });

  const operators: { email: string }[] = [];
  for (let i = 0; i < OPERATORS; i++) {
    const entity = await prisma.entity.create({
      data: {
        name: `Load Operator ${i}`,
        type: i < 3 ? EntityType.MNO : EntityType.ISP,
        status: EntityStatus.ACTIVE,
        licenceNumber: `${TAG}/${i}`,
      },
    });
    const email = `load${i}@loadtest.invalid`;
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Load',
        lastName: `Op ${i}`,
        role: Role.OPERATOR_ADMIN,
        entityId: entity.id,
      },
    });
    operators.push({ email });
  }

  // --- One operator's afternoon ----------------------------------------------
  const login = async (email: string) => {
    // Login answers 200 with an MFA challenge, or 201 with a token when MFA is off. Both are a
    // successful login, so this reads the body rather than insisting on a status.
    const first = await call('POST', '/api/v1/auth/login', {
      body: { email, password: PASSWORD },
    });
    if (first.status >= 400) {
      throw new Error(`login failed ${first.status}: ${JSON.stringify(first.body).slice(0, 200)}`);
    }
    if (first.body.accessToken) return first.body.accessToken as string;

    const verified = await call('POST', '/api/v1/auth/verify-otp', {
      body: { challengeId: first.body.challengeId, code: OTP },
    });
    if (!verified.body.accessToken) {
      throw new Error(
        `otp failed ${verified.status}: ${JSON.stringify(verified.body).slice(0, 200)}`,
      );
    }
    return verified.body.accessToken as string;
  };

  const afternoon = (email: string) => async () => {
    const token = await timed('login', () => login(email), email);

    const draft = await timed(
      'open draft',
      () => expect('POST', '/api/v1/submissions', 201, { token, body: { periodId: period.id } }),
      email,
    );
    const id = draft.id as string;

    // The editor sends every field on every save, not only the ones that changed.
    for (let s = 0; s < SAVES_PER_OPERATOR; s++) {
      const values = fieldIds.map((fieldId, i) => ({ fieldId, valueText: String(i + s) }));
      await timed(
        'autosave',
        () => expect('PUT', `/api/v1/submissions/${id}/values`, 200, { token, body: { values } }),
        email,
      );
    }

    // An operator checks a couple of times before filing.
    for (let c = 0; c < 2; c++) {
      await timed(
        'validate',
        () => expect('POST', `/api/v1/submissions/${id}/validate`, 201, { token }),
        email,
      );
    }

    await timed(
      'submit',
      () =>
        expect('POST', `/api/v1/submissions/${id}/submit`, 201, {
          token,
          body: { signedName: 'Load Op' },
        }),
      email,
    );
  };

  // --- Run the burst ---------------------------------------------------------
  const started = Date.now();
  const outcomes = await pool(
    operators.map((o) => afternoon(o.email)),
    CONCURRENCY,
  );
  const elapsed = (Date.now() - started) / 1000;

  const failed = outcomes.filter((o) => o.status === 'rejected');
  report();
  rateReport(elapsed);
  console.log(
    `${OPERATORS - failed.length}/${OPERATORS} operators filed in ${elapsed.toFixed(1)}s ` +
      `(${samples.length} requests, ${samples.filter((s) => !s.ok).length} failed).`,
  );
  if (failed.length > 0) {
    console.log('');
    console.log('First failure:');
    console.log(String((failed[0] as PromiseRejectedResult).reason).slice(0, 600));
  }

  await cleanup();
  agent.destroy();
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
