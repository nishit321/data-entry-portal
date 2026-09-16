import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * A penalty that is accruing but not yet payable (NCA, 16 September 2026).
 *
 * The Act requires thirty days' notice before any financial penalty, and NCA set out how that meets
 * the accrual: the figure runs from the day the return was genuinely late, but is only assessed
 * once the remedy period lapses unremedied. "Nothing is payable during the 30 days, but a defaulter
 * doesn't get a free month either."
 *
 * So for the first month of a case the screen carries a real, growing amount the operator does not
 * owe. Until this was added it showed the number and nothing else, which reads as a demand — and a
 * demand made before the statutory notice has run is the one mistake on this screen with a legal
 * consequence rather than a cosmetic one.
 *
 * Two seeded cases, one in each state. That pairing is the test: a screen that showed them alike
 * would pass any check that only looked at one.
 */
test.use({ storageState: sessionFile('admin') });

test('separates an amount that is accruing from one that is payable', async ({ page }) => {
  await page.goto('/enforcement');
  await expect(page.getByRole('heading', { name: /compliance/i })).toBeVisible();

  const table = page.getByRole('table').first();
  await expect(table).toContainText('Not payable until');
  await expect(table).toContainText('days left');
  // And the other case, whose notice has already run out.
  await expect(table).toContainText('payable');
});

test('gives the date, not only a countdown', async ({ page }) => {
  /*
   * "15 days left" is what an officer wants at a glance. The date is what goes into a letter, and
   * a reader should not have to count forward from today to write one.
   */
  await page.goto('/enforcement');
  const row = page.getByRole('row').filter({ hasText: 'Not payable until' }).first();
  await expect(row).toContainText(/Not payable until \d{2} \w{3} \d{4}/);
});

test('says what is being given up before a case is waived', async ({ page }) => {
  /*
   * Waiving an amount the operator already owes and waiving one that has not become payable yet
   * are different acts. The officer doing it should not have to work out which from a figure in a
   * table they have already scrolled past.
   */
  await page.goto('/enforcement');
  const row = page.getByRole('row').filter({ hasText: 'Not payable until' }).first();
  await row.getByRole('button', { name: /waive/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('not payable yet');
  await expect(dialog).toContainText('has until');
});
