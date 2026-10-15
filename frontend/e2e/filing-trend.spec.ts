import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Filing against obligation, on the screen people actually open (NCA, 16 September 2026).
 *
 * The Authority asked for trends on the dashboard, percentage changes, and a comparison with the
 * previous period. Underneath that ask is a number the portal did not have: how many operators
 * owed a return. Every figure on the dashboard was a count of returns that arrived, and a count of
 * what arrived cannot describe what did not. A period half the sector ignored produced the same
 * short bar as a quiet period with fewer obligations.
 *
 * These tests hold the denominator to the screen. Without it the card would still render and still
 * look reasonable, which is exactly why it needs a test rather than a look.
 */

/**
 * The chart itself, found by the name it already carries for screen readers rather than by a hook
 * added for the test. If that name ever goes missing the chart is unreachable to a screen reader,
 * and these tests should fail for that alone.
 */
const chart = (page: Page) => page.getByRole('img', { name: /^Filings per period/ });

test.describe('signed in as the Authority', () => {
  test.use({ storageState: sessionFile('admin') });

  test('puts filing over time on the dashboard, not only on the analytics screen', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Filing over time' })).toBeVisible();

    // The three figures the Authority asked for, each with its own words.
    await expect(page.getByText('Returns filed').first()).toBeVisible();
    await expect(page.getByText('Filed of those owed').first()).toBeVisible();
    await expect(page.getByText('Filed on time').first()).toBeVisible();
  });

  test('says how the latest period compares with the one before it', async ({ page }) => {
    await page.goto('/');
    // "2026 Q2, against 2026 Q1" - the comparison is named, so nobody has to guess the baseline.
    await expect(page.getByText(/, against /)).toBeVisible();
    // And the movement is in words, not only an arrow and a colour.
    await expect(page.getByText(/^(up|down) \d|^no change|^No comparison/).first()).toBeVisible();
  });

  test('counts the returns that never arrived', async ({ page }) => {
    /*
     * The whole reason for the work. A chart drawn from filings alone is silent about a missed
     * return, because there is no row to draw. This checks the chart is drawn from the obligation
     * instead: the bar carries a "not filed" band and the description says how many owed a return.
     */
    await page.goto('/');
    await expect(chart(page)).toHaveAttribute('aria-label', /\d+ of \d+ filed/);
    await expect(chart(page)).toHaveAttribute('aria-label', /\d+ not filed/);
    await expect(page.getByText('Not filed').first()).toBeVisible();
  });

  test('describes every period to a screen reader, not just the picture', async ({ page }) => {
    // The bars are divs with no text of their own. The description is the only way this chart
    // reaches somebody who cannot see it.
    await page.goto('/');
    const label = await chart(page).getAttribute('aria-label');
    expect(label).toMatch(/^Filings per period\./);
    expect((label ?? '').length).toBeGreaterThan(40);
  });
});

test.describe('signed in as an operator', () => {
  test.use({ storageState: sessionFile('operator') });

  test('shows an operator their own record, not the sector', async ({ page }) => {
    /*
     * The denominator has to be scoped the same way the returns are. An operator that filed its one
     * return should read 100%, not "1 of 12". Getting this wrong would tell a compliant operator it
     * had missed eleven returns it never owed.
     */
    await page.goto('/');
    const label = (await chart(page).getAttribute('aria-label')) ?? '';

    const owed = [...label.matchAll(/of (\d+) filed/g)].map((m) => Number(m[1]));
    expect(owed.length).toBeGreaterThan(0);
    // One operator, so at most one return is owed per period.
    expect(Math.max(...owed)).toBe(1);
  });
});
