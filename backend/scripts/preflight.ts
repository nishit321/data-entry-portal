/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Read the configuration this environment would actually start with, and say what is not fit for
 * production (§ "Security checklist for a production deploy", OPERATIONS.md).
 *
 *   npm run preflight
 *
 * That checklist was seven lines resting entirely on somebody remembering to read them on the
 * night. The failures it guards against are the expensive kind and the quiet kind at once: a demo
 * JWT secret that makes every session forgeable, a mail transport that logs one-time codes to a
 * console nobody is watching so no user can ever sign in, a CORS wildcard that lets any page on
 * the internet act as the portal.
 *
 * Three outcomes, not two. A check that could not run reports `??` and exits non-zero, because a
 * question that was never asked has not been answered — the same rule as `backup:verify`.
 */
import 'dotenv/config';
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_SMS_ENDPOINT } from '../src/common/constants/app.constants';

type Outcome = 'ok' | 'failed' | 'warn' | 'unknown';

interface Check {
  what: string;
  outcome: Outcome;
  detail: string;
}

const MARKS: Record<Outcome, string> = {
  ok: 'ok  ',
  failed: 'FAIL',
  warn: 'warn',
  unknown: '??  ',
};

const checks: Check[] = [];
const record = (what: string, outcome: Outcome, detail = '') =>
  checks.push({ what, outcome, detail });

const env = (name: string): string => (process.env[name] ?? '').trim();

/** Values that ship in `.env.example` and the seed. Live anywhere means live with a known secret. */
const DEMO_VALUES = new Set([
  'change-me',
  'changeme',
  'secret',
  'development-secret',
  'dev-secret-change-me',
  'Admin@12345',
  'Operator@12345',
  'Reviewer@12345',
  '123456',
]);

function checkNodeEnv() {
  const value = env('NODE_ENV');
  if (value === 'production') {
    record('NODE_ENV', 'ok', 'production');
    return true;
  }
  record(
    'NODE_ENV',
    'failed',
    `${value || 'unset'}. Everything below is being judged against a non-production environment.`,
  );
  return false;
}

function checkJwtSecret() {
  const secret = env('JWT_SECRET');
  if (!secret) {
    record('JWT secret', 'failed', 'not set. The application will refuse to start.');
    return;
  }
  if (DEMO_VALUES.has(secret) || secret.toLowerCase().includes('change')) {
    record('JWT secret', 'failed', 'still a placeholder. Every session token is forgeable.');
    return;
  }
  if (secret.length < 32) {
    record(
      'JWT secret',
      'warn',
      `${secret.length} characters. The schema allows 16; 32 or more is the sensible floor.`,
    );
    return;
  }
  record('JWT secret', 'ok', `${secret.length} characters`);
}

function checkCors() {
  const origins = env('CORS_ORIGIN');
  if (!origins) {
    record('CORS origins', 'warn', 'unset, so the localhost default applies.');
    return;
  }
  if (origins.includes('*')) {
    record('CORS origins', 'failed', 'a wildcard. Any page on the internet may call this API.');
    return;
  }
  const insecure = origins
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.startsWith('http://') && !o.includes('localhost'));
  if (insecure.length > 0) {
    record('CORS origins', 'failed', `plain http: ${insecure.join(', ')}`);
    return;
  }
  record('CORS origins', 'ok', origins);
}

function checkMail() {
  if (!env('SENDGRID_API_KEY')) {
    record(
      'mail transport',
      'failed',
      'no API key, so mail is written to the console. Nobody receives a one-time code, which ' +
        'means nobody signs in.',
    );
    return;
  }
  record('mail transport', 'ok', `sending as ${env('MAIL_FROM') || 'no-reply@nca.gov.ss'}`);
}

function checkSms() {
  const token = env('SMS_API_TOKEN');
  const sender = env('SMS_SENDER_ID');
  // Unset means the default applies, which is what the application would start with.
  const url = env('SMS_API_URL') || DEFAULT_SMS_ENDPOINT;

  if (!token) {
    // Not a failure. SMS is a second way of reaching somebody, never the only one, and the portal
    // works without it exactly as it did before a gateway existed.
    record('SMS gateway', 'warn', 'no token, so text messages are switched off.');
    return;
  }
  if (!url.startsWith('https://')) {
    record('SMS gateway', 'failed', 'the endpoint is not https. The token travels in the body.');
    return;
  }
  if (!sender) {
    record('SMS gateway', 'failed', 'no sender ID, so the gateway will refuse every message.');
    return;
  }
  if (sender.length > 11 && !/^\+?\d+$/.test(sender)) {
    // The gateway caps an alphanumeric sender at eleven characters; a number may be longer.
    record('SMS gateway', 'failed', `sender ID "${sender}" is longer than 11 characters.`);
    return;
  }
  record('SMS gateway', 'ok', `sending as ${sender}`);
}

function checkMfa() {
  const enabled = env('MFA_ENABLED') !== 'false';
  const echo = env('OTP_ECHO_IN_RESPONSE') === 'true';
  const staticCode = env('OTP_STATIC_CODE');

  if (!enabled) {
    record('MFA', 'failed', 'turned off. A password alone opens an operator account.');
  } else {
    record('MFA', 'ok', 'on');
  }

  if (echo) {
    record(
      'one-time codes',
      'failed',
      'echoed in the login response. The second factor is handed to whoever asked for it.',
    );
  } else if (staticCode && staticCode !== '123456') {
    record('one-time codes', 'warn', 'a fixed code is configured. Codes should be generated.');
  } else if (staticCode === '123456') {
    record('one-time codes', 'failed', 'the demo code 123456 is still in place.');
  } else {
    record('one-time codes', 'ok', 'generated per challenge');
  }
}

function checkSeedAccount() {
  const password = env('SEED_ADMIN_PASSWORD');
  if (!password || DEMO_VALUES.has(password)) {
    record(
      'seeded admin password',
      'failed',
      'still the demo value. The first account in the system has a published password.',
    );
    return;
  }
  record('seeded admin password', 'ok', 'changed from the demo value');
}

function checkDatabaseUrl() {
  const url = env('DATABASE_URL');
  if (!url) {
    record('database', 'failed', 'DATABASE_URL is not set.');
    return;
  }
  try {
    const parsed = new URL(url);
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);

    if (user === 'postgres') {
      record(
        'database credentials',
        'failed',
        'connecting as the superuser. The app needs its own database and nothing else.',
      );
      return;
    }
    if (!password || DEMO_VALUES.has(password) || password === 'root') {
      record('database credentials', 'failed', 'a placeholder password.');
      return;
    }
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (local) {
      record('database credentials', 'warn', `as ${user}, on this machine.`);
      return;
    }
    const sslmode = parsed.searchParams.get('sslmode');
    if (!sslmode || sslmode === 'disable') {
      record(
        'database credentials',
        'failed',
        `as ${user}, over the network with sslmode=${sslmode ?? 'unset'}.`,
      );
      return;
    }
    record('database credentials', 'ok', `as ${user}, sslmode=${sslmode}`);
  } catch {
    record('database credentials', 'unknown', 'DATABASE_URL could not be parsed.');
  }
}

function checkThrottle() {
  const limit = Number(env('THROTTLE_LIMIT') || 100);
  const ttl = Number(env('THROTTLE_TTL_SEC') || 60);
  if (!Number.isFinite(limit) || !Number.isFinite(ttl) || ttl <= 0) {
    record('rate limiting', 'unknown', 'the limit or window is not a number.');
    return;
  }
  const perMinute = Math.round((limit / ttl) * 60);
  // Measured in the deadline-spike harness: one person typing reaches about 30 requests a minute
  // through the autosave debounce, whatever they are typing.
  const people = Math.floor(perMinute / 30);
  // Below roughly three people on one office connection, staff start blocking each other.
  if (perMinute < 90) {
    record(
      'rate limiting',
      'warn',
      `${perMinute} requests a minute per IP. An office shares one address, so this is ` +
        `${people === 1 ? 'one person' : `${people} people`} typing at once.`,
    );
    return;
  }
  record('rate limiting', 'ok', `${perMinute} requests a minute per IP`);
}

function checkTlsTermination() {
  const header = env('MACHINE_CLIENT_CERT_HEADER');
  if (!header) {
    record(
      'client certificates (Q10)',
      'warn',
      'no header configured, so mTLS fingerprints cannot reach the machine API.',
    );
  } else {
    record('client certificates (Q10)', 'ok', `read from ${header}`);
  }

  /*
   * How many proxies sit in front cannot be discovered from inside the process. It can, however,
   * be *stated* — and a stated number is visible, reviewable, and wrong in an obvious way rather
   * than a silent one. Getting it wrong hurts in both directions: too few hops and every caller
   * looks like the proxy, so one operator's traffic rate-limits everyone else and the audit log
   * records the wrong address for all of them; too many and a caller writes their own
   * X-Forwarded-For and is believed.
   */
  const hops = env('TRUST_PROXY_HOPS');
  if (!hops) {
    record(
      'proxy hop count',
      'unknown',
      'not stated, so the default of 1 applies. Set TRUST_PROXY_HOPS to the number of proxies in ' +
        'front of the app, and this becomes a fact rather than an assumption.',
    );
    return;
  }
  record('proxy hop count', 'ok', `${hops} stated. Confirm it matches the deployment.`);
}

function checkStorage() {
  const dir = resolve(env('STORAGE_DIR') || 'storage');
  if (!existsSync(dir)) {
    record('attachment store', 'warn', `${dir} does not exist yet.`);
    return;
  }
  if (!statSync(dir).isDirectory()) {
    record('attachment store', 'failed', `${dir} is not a directory.`);
    return;
  }
  const count = readdirSync(dir).length;
  record('attachment store', 'ok', `${dir} (${count} entries)`);
}

/** A restore rehearsed longer ago than this says more about the calendar than about the backups. */
const REHEARSAL_STALE_DAYS = 90;

function checkBackups() {
  /*
   * Whether backups run, run off-host, and are encrypted is not visible from inside this process.
   * What can be recorded is the answer: the date a restore was last rehearsed. That turns "cannot
   * be checked" into "has not been answered yet", which is a question somebody can actually close,
   * and it goes stale on its own so the answer cannot be given once and then forgotten.
   */
  const stated = env('BACKUP_VERIFIED_AT');
  if (!stated) {
    record(
      'restore rehearsed',
      'unknown',
      'no date recorded. Run backup:verify, then set BACKUP_VERIFIED_AT to the date it passed. ' +
        'A backup nobody has restored is a guess.',
    );
    return;
  }
  const when = new Date(stated);
  if (Number.isNaN(when.getTime())) {
    record('restore rehearsed', 'failed', `BACKUP_VERIFIED_AT is not a date: "${stated}".`);
    return;
  }
  const days = Math.floor((Date.now() - when.getTime()) / 86_400_000);
  if (days > REHEARSAL_STALE_DAYS) {
    record(
      'restore rehearsed',
      'failed',
      `${days} days ago. Run backup:verify again and record the new date.`,
    );
    return;
  }
  record('restore rehearsed', 'ok', `${days} days ago`);
}

function checkScheduler() {
  if (env('SCHEDULER_ENABLED') === 'false') {
    record(
      'background jobs',
      'failed',
      'the scheduler is off. Nothing sweeps for overdue returns, expiring documents, or ' +
        'reminders.',
    );
    return;
  }
  record('background jobs', 'ok', 'scheduler on');
}

function main() {
  console.log('');
  console.log('  Reading the configuration this environment would start with.');
  console.log('');

  const isProduction = checkNodeEnv();
  checkJwtSecret();
  checkCors();
  checkTlsTermination();
  checkMail();
  checkSms();
  checkMfa();
  checkSeedAccount();
  checkDatabaseUrl();
  checkThrottle();
  checkStorage();
  checkBackups();
  checkScheduler();

  const width = Math.max(...checks.map((c) => c.what.length)) + 2;
  console.log('');
  for (const check of checks) {
    console.log(`  ${MARKS[check.outcome]}  ${check.what.padEnd(width)}${check.detail}`);
  }
  console.log('');

  const failed = checks.filter((c) => c.outcome === 'failed');
  const unknown = checks.filter((c) => c.outcome === 'unknown');
  const warned = checks.filter((c) => c.outcome === 'warn');

  if (!isProduction) {
    console.log(
      '  This is not a production environment, so most of the above is expected to read badly.',
    );
    console.log('  Run this again against the deployment target before a release.');
    console.log('');
  }

  const parts = [
    `${checks.length - failed.length - unknown.length - warned.length} passed`,
    failed.length ? `${failed.length} failed` : '',
    warned.length ? `${warned.length} to look at` : '',
    unknown.length ? `${unknown.length} could not be checked` : '',
  ].filter(Boolean);
  console.log(`  ${parts.join(', ')}.`);

  if (unknown.length > 0) {
    console.log('  A `??` is not a pass. Confirm those by hand and record the answer.');
  }
  console.log('');

  // Non-zero for anything unresolved, so this can gate a deploy rather than decorate one.
  process.exit(failed.length + unknown.length > 0 ? 1 : 0);
}

main();
