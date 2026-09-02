import { test as setup } from '@playwright/test';
import { ACCOUNTS, sessionFile, signIn } from './helpers';

/**
 * Sign in once per role and park the session.
 *
 * Not only for speed. Sign-in is rate-limited and guarded by account lockout — as it should be —
 * so a suite that signs in afresh for every test starts locking itself out around the sixth one,
 * and the failure looks like a broken page rather than a test doing something no real person does.
 * The sign-in path itself is still exercised end to end, here and in the journey.
 */
for (const who of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
  setup(`sign in as ${who}`, async ({ page }) => {
    await signIn(page, who);
    await page.context().storageState({ path: sessionFile(who) });
  });
}
