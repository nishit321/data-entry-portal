import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Can an administrator tell what each "Run now" button does?
 *
 * The overnight checks are listed here with a button beside each, and four of the seven arrived
 * with no title and no explanation — the page had copy for three. So the screen offered a button
 * that ran something unnamed, which is the one thing a control like this must never be.
 *
 * `scheduler-jobs.e2e-spec.ts` on the server holds the two lists to each other. This is the other
 * half of the same guarantee: that what the page has copy for is what it actually renders. A map
 * can be complete and a row still come out blank.
 */
test.use({ storageState: sessionFile('admin') });

test('names every overnight check, and says what it will do', async ({ page }) => {
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'Overnight checks' })).toBeVisible();

  const buttons = page.getByRole('button', { name: 'Run now' });
  const count = await buttons.count();
  // Seven jobs today. Asserted as "more than the three that had copy", so adding an eighth does
  // not fail this while still catching a list that has quietly shrunk.
  expect(count).toBeGreaterThan(3);

  /*
   * Every row is read as a whole: a heading, a sentence under it, and the button.
   *
   * Checking only that the button exists would have passed all along — the buttons were never the
   * problem. What was missing was everything that told you what pressing one would do.
   */
  for (let i = 0; i < count; i += 1) {
    const row = buttons.nth(i).locator('xpath=ancestor::*[self::div][1]/..');
    const text = ((await row.innerText()) ?? '').replace(/Run now/g, '').trim();
    expect(text.length, `row ${i + 1} has no text beside its Run now button`).toBeGreaterThan(20);
  }

  // And the four that were blank are named by name, so this fails if they regress rather than
  // merely if some text is present.
  for (const name of [
    'Penalty update',
    'Scheduled reports',
    'Machine request clean-up',
    'Operator data feeds',
  ]) {
    // Scoped to the content: "Scheduled reports" is also a navigation item, and matching that
    // would pass even if the row itself were still blank.
    await expect(page.getByRole('main').getByText(name, { exact: true })).toBeVisible();
  }
});
