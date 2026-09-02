import 'reflect-metadata';

// e2e tests run against a dedicated test database, never the dev/prod one.
// These are set BEFORE the app's ConfigModule loads .env; dotenv does not
// override already-set process.env keys, so these win.
process.env.NODE_ENV = 'test';
// Every e2e suite boots a whole Nest app, and each one opens its own Prisma pool. Prisma sizes a
// pool from the CPU count by default, which across parallel suites is far more connections than
// Postgres will grant, and the ones it refuses surface as ECONNRESET part-way through a run. Five
// is comfortably more than any single suite uses at once.
const TEST_POOL_SIZE = 5;
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:root@localhost:5432/nca_portal_test?schema=public';
process.env.DATABASE_URL = url.includes('connection_limit=')
  ? url
  : `${url}${url.includes('?') ? '&' : '?'}connection_limit=${TEST_POOL_SIZE}`;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret-string-1234567890';
// Force the email console-fallback so tests never hit SendGrid.
process.env.SENDGRID_API_KEY = '';
