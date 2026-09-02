import { expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const here = resolve(fileURLToPath(import.meta.url), '..');

/** Where a signed-in session is parked so the whole suite signs in once per role. */
export const sessionFile = (who: string) => resolve(here, `.auth/${who}.json`);

/**
 * The seeded accounts. `prisma/seed.ts` creates these and the global setup runs it, so they are
 * the same on every run.
 */
export const ACCOUNTS = {
  operator: { email: 'operator@demo-telecom.ss', password: 'Operator@12345' },
  admin: { email: 'admin@nca.gov.ss', password: 'Admin@12345' },
  checker: { email: 'checker@nca.gov.ss', password: 'Reviewer@12345' },
};

/** The static demo code. MFA is on, and outside production the OTP is fixed so this can be typed. */
const OTP = '123456';

/**
 * Sign in through the real form, rather than by planting a token.
 *
 * Slower, and worth it: the sign-in path is two steps with an MFA gate in the middle, and it is
 * the one screen every user meets. A shortcut past it would leave the most-used page in the
 * product with no browser coverage at all.
 */
export async function signIn(page: Page, who: keyof typeof ACCOUNTS = 'operator') {
  const account = ACCOUNTS[who];

  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  // Anchored, because the show/hide toggle beside it is also labelled "…password".
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.getByLabel('One-time code').fill(OTP);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  // Landed somewhere inside the shell.
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
}
