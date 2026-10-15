/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Everything a live portal needs, and nothing it does not.
 *
 *   npm run seed:production
 *
 * Two things, both of which a real deployment cannot work without:
 *
 *  - **The administrator**, so somebody can sign in and create the real accounts.
 *  - **The reference lists** the questionnaire's dropdowns read: service types, technologies,
 *    spectrum bands, geographic classifications, energy types, fixed access types, transaction
 *    types. Without these, Section 6 of the questionnaire is shown to nobody, because it is gated
 *    on the `MOBILE_MONEY` service code.
 *
 * It creates **no operator, no questionnaire, no returns, no agents, no cases**. `npm run
 * prisma:seed` does all of that, and it is a demonstration.
 *
 * ## Why this is a separate command
 *
 * Until 16 September 2026 there was one seed, and running it on a live server meant creating a
 * demonstration and then deleting it by hand, screen by screen, while real people were signing in.
 * The safest deletion is the one nobody has to make.
 *
 * ## The two refusals
 *
 * Under `NODE_ENV=production` this stops before writing anything if the administrator password or
 * the one-time code is still a published demo value. Both are printed in `.env.example`, so a
 * server carrying either has no first account and no second factor worth the name. The check runs
 * *before* the insert on purpose: an admin created with a known password is a row somebody then
 * has to remember to go back and fix.
 */
import { seedAdmin, seedReferenceData, prisma } from './seed-core';

/** Values that ship in `.env.example`. Live anywhere means live with a published secret. */
const PUBLISHED = new Set([
  'Admin@12345',
  'Reviewer@12345',
  'Operator@12345',
  '123456',
  'change-this-to-a-long-random-secret-string',
]);

function assertSecretsAreReal(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? '';
  const otp = process.env.OTP_STATIC_CODE ?? '';

  if (!adminPassword || PUBLISHED.has(adminPassword)) {
    problems.push(
      'SEED_ADMIN_PASSWORD is unset or still the demo value. The first account in the system ' +
        'would have a password printed in .env.example.',
    );
  }
  if (!otp || PUBLISHED.has(otp)) {
    problems.push(
      'OTP_STATIC_CODE is unset or still 123456. The emailed one-time code is whatever this ' +
        'value says, for every user, every time: the second factor would be a published number.',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to seed a production database with published secrets:\n  - ${problems.join(
        '\n  - ',
      )}\nSet them in .env, restart, and run this again. Nothing has been written.`,
    );
  }
}

async function run() {
  const mode = process.env.NODE_ENV ?? 'development';
  console.log(`Seeding what a live portal needs (NODE_ENV=${mode}).`);
  console.log('');

  assertSecretsAreReal();

  await seedAdmin();
  await seedReferenceData();

  console.log('');
  console.log('Done. This created no operator, no questionnaire and no returns.');
  console.log('Next: npm run seed:questionnaire, then publish it from the Templates screen.');
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
