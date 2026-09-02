/* eslint-disable no-console */
import { execSync } from 'child_process';

/**
 * Provision the e2e test database: create it if missing, then apply migrations.
 * Idempotent and cross-platform. Override the target with TEST_DATABASE_URL.
 *
 *   npm run test:e2e:setup
 */
const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:root@localhost:5432/nca_portal_test?schema=public';

const url = new URL(TEST_URL);
const dbName = url.pathname.replace(/^\//, '');
if (!dbName) throw new Error('TEST_DATABASE_URL has no database name');

// A maintenance connection (the default `postgres` db) to issue CREATE DATABASE.
const maintenance = new URL(TEST_URL);
maintenance.pathname = '/postgres';

console.log(`Ensuring test database "${dbName}" exists…`);
try {
  execSync(`npx prisma db execute --url "${maintenance.toString()}" --stdin`, {
    input: `CREATE DATABASE ${dbName};`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log(`  created.`);
} catch {
  console.log(`  already exists, continuing.`);
}

console.log('Applying migrations to the test database…');
execSync('npx prisma migrate deploy', {
  env: { ...process.env, DATABASE_URL: TEST_URL },
  stdio: 'inherit',
});
console.log('Test database ready.');
