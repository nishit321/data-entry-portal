/* eslint-disable no-console */
import { execSync } from 'child_process';

/**
 * Reset a database, but only ever a test one.
 *
 * The browser suite has to start from a known state, so its web server runs `prisma migrate reset`
 * before every run. That command drops everything and rebuilds from the migrations, and it takes
 * its target from `DATABASE_URL` — whatever `DATABASE_URL` happens to be at that moment.
 *
 * On 5 September 2026 the development database was rebuilt from scratch during a run of that
 * suite. Everything in it was lost, and there was no backup. The Playwright config sets
 * `DATABASE_URL` to a separate test database and, tested on its own, the Prisma CLI does honour
 * that override — so the configuration was not obviously wrong, and it happened anyway.
 *
 * Which is the point of this file. A destructive command should not depend on a chain of
 * environment resolution being correct in every shell, on every platform, in every wrapper that
 * may sit between the config and the process. It should read the address it is about to destroy
 * and refuse if it is not one of the two it is allowed to.
 *
 * The check runs in the same process that runs the reset, reading the same variable, at the same
 * moment — so there is no gap between what was checked and what is acted on.
 */

/** Databases this script may destroy. Nothing else, whatever the environment says. */
const ALLOWED = [/_test$/, /_uitest$/];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('reset-test-db: DATABASE_URL is not set. Refusing to guess.');
  process.exit(1);
}

let name: string;
try {
  name = new URL(url).pathname.replace(/^\//, '');
} catch {
  console.error('reset-test-db: DATABASE_URL is not a URL this can read. Refusing.');
  process.exit(1);
}

if (!name) {
  console.error('reset-test-db: DATABASE_URL names no database. Refusing.');
  process.exit(1);
}

if (!ALLOWED.some((pattern) => pattern.test(name))) {
  console.error(
    [
      '',
      `  reset-test-db: refusing to reset "${name}".`,
      '',
      '  This command drops every table and rebuilds from the migrations. It is only ever run',
      '  against a test database, and the name it was handed is not one:',
      '',
      `    DATABASE_URL -> ${name}`,
      '',
      '  A test database name ends in _test or _uitest. If you meant to reset a development',
      '  database, do it by hand. Take a backup first: `npm run backup`.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`reset-test-db: resetting "${name}".`);
execSync('npx prisma migrate reset --force --skip-seed', { stdio: 'inherit' });
