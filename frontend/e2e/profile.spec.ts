import { expect, test } from '@playwright/test';
import { report, scan } from './axe';
import { sessionFile } from './helpers';

/**
 * The profile screen, which is where a phone number is added and confirmed.
 *
 * The browser suite runs against a server with no SMS gateway configured, so what can be proved
 * here is the half that does not need one: the screen exists, it is reachable from the account
 * menu, it says plainly that texts are not set up rather than offering a button that cannot work,
 * and it has no accessibility violations. Confirming a real number is covered by the backend e2e
 * suite, where the gateway is replaced at its own boundary.
 */
test.use({ storageState: sessionFile('operator') });

test('is reachable from the account menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Your details' }).click();

  await expect(page).toHaveURL(/\/profile/);
  // By level: the top bar names the current page as an h1 and the page header repeats it as an
  // h2, which every screen in the portal does.
  await expect(page.getByRole('heading', { level: 2, name: 'Your details' })).toBeVisible();
});

test('says texts are not set up rather than offering a button that cannot work', async ({
  page,
}) => {
  await page.goto('/profile');
  await expect(page.getByText(/Text messages are not set up/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send me a code' })).toBeDisabled();
});

test('has no accessibility violations', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  const { violations } = await scan(page);
  expect(violations, report(violations)).toEqual([]);
});
