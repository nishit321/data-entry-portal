import { expect, test } from '@playwright/test';
import { report, scan } from './axe';
import { sessionFile } from './helpers';

/**
 * The profile screen, which is where a phone number is added and confirmed.
 *
 * Deliberately stops short of sending anything. A real send costs the Authority credit and rings a
 * handset, and whether one arrived is not something a browser can check. What is checked here is
 * that the screen exists, is reachable from the account menu, never offers an action it cannot
 * perform, and has no accessibility violations. Confirming a number end to end is covered by the
 * backend e2e suite, where the gateway is replaced at its own boundary.
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

test('is coherent whether or not a gateway is configured', async ({ page }) => {
  await page.goto('/profile');

  /*
   * Both states are asserted rather than one.
   *
   * The first version of this test assumed no SMS gateway, because there was none when it was
   * written. A token was then set in `.env` and the test failed — not because anything broke, but
   * because it had written down a passing environment as though it were a fact about the product.
   * What is actually true either way is that the screen never offers an action it cannot perform.
   */
  const notice = page.getByText(/Text messages are not set up/);
  const numberField = page.getByLabel(/number/i);

  if (await notice.isVisible()) {
    // No gateway: say so, and do not offer a box to type into.
    await expect(numberField).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send me a code' })).toBeDisabled();
  } else {
    // A gateway: the box works, and the button waits for something worth sending.
    await expect(numberField).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Send me a code' })).toBeDisabled();
    await numberField.fill('0920000000');
    await expect(page.getByRole('button', { name: 'Send me a code' })).toBeEnabled();
  }
});

test('has no accessibility violations', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  const { violations } = await scan(page);
  expect(violations, report(violations)).toEqual([]);
});
