import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Do two fields side by side put their controls on the same line?
 *
 * This has to be a browser test. jsdom reports every element as zero by zero, so a unit test can
 * assert a layout rule all day and mean nothing by it — which is how the original defect survived:
 * one field carried a hint, its neighbour did not, and the hint took a line that pushed one select
 * below the other.
 *
 * The schedule form is the case it was found in, and it became a better one on 15 September 2026.
 * The day is now picked on a calendar, and the line under it states the recurring rule that date
 * produced — so the hint appears and disappears while somebody is filling the form in, rather than
 * only when they change the frequency. A row that lines up in one state and not the other is a row
 * that visibly jumps under the cursor.
 */
test.use({ storageState: sessionFile('admin') });

test('a hint on one field does not push its neighbour out of line', async ({ page }) => {
  await page.goto('/scheduled-reports');
  await page.getByRole('button', { name: 'Schedule a report' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const day = dialog.getByRole('button', { name: 'Day it goes out' });
  const time = dialog.getByRole('combobox', { name: 'Time it goes out' });

  const top = async (locator: typeof time) => (await locator.boundingBox())!.y;
  // A pixel of slack for sub-pixel rounding, and no more: two lines apart is what this is about.
  const aligned = async () =>
    expect(Math.abs((await top(day)) - (await top(time)))).toBeLessThanOrEqual(1);

  // Nothing picked yet, so neither field carries a hint.
  await expect(dialog.getByText(/Goes out on the/)).toBeHidden();
  await aligned();

  // Pick a date. The line underneath appears, and the row must not move.
  await day.click();
  await page.getByRole('dialog', { name: /Choose a date/ }).waitFor();
  await page.getByRole('gridcell', { name: /^12 / }).click();
  await expect(dialog.getByText(/Goes out on the 12th of every month/)).toBeVisible();
  await aligned();
});

test('the calendar states the recurring rule the chosen date produced', async ({ page }) => {
  /*
   * "Report Scheduling: Include date selection functionality." (NCA, 15 September 2026)
   *
   * A calendar is how the day is chosen; it is not what the schedule keeps. A recurring report has
   * a day, not a date — pick the 12th and it goes out on the 12th of every month, for as long as
   * the schedule lives. That is a thing a form can very easily fail to say, leaving somebody to
   * believe they have set up a single send on one date. So the sentence under the picker is the
   * feature as much as the picker is, and it changes with the frequency.
   */
  await page.goto('/scheduled-reports');
  await page.getByRole('button', { name: 'Schedule a report' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Day it goes out' }).click();
  await page.getByRole('dialog', { name: /Choose a date/ }).waitFor();
  await page.getByRole('gridcell', { name: /^12 / }).click();
  await expect(dialog.getByText('Goes out on the 12th of every month.')).toBeVisible();

  // The same date means a weekday once the schedule is weekly, and the sentence has to keep up.
  await dialog.getByRole('combobox', { name: /How often/i }).click();
  await page.getByRole('option', { name: /week/i }).click();
  await expect(
    dialog.getByText(/Goes out every (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\./),
  ).toBeVisible();

  // And a quarter names the four months, because "quarterly" on its own does not say which.
  await dialog.getByRole('combobox', { name: /How often/i }).click();
  await page.getByRole('option', { name: /quarter/i }).click();
  await expect(
    dialog.getByText('Goes out on the 12th of January, April, July and October.'),
  ).toBeVisible();
});

test('refuses a day of the month that February does not have', async ({ page }) => {
  /*
   * The one thing a calendar makes easy to get wrong that a list of 1 to 28 made impossible.
   *
   * A report set for the 30th would have no date at all in most Februaries, and a schedule that
   * silently skips a month is the kind of fault nobody notices until a quarter-end review. Said
   * where the date was chosen, and the button stays disabled until it is fixed.
   */
  await page.goto('/scheduled-reports');
  await page.getByRole('button', { name: 'Schedule a report' }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E date rule');
  await dialog.getByRole('button', { name: 'Day it goes out' }).click();
  await page.getByRole('dialog', { name: /Choose a date/ }).waitFor();

  await page.getByRole('gridcell', { name: /^30 / }).click();

  await expect(dialog.getByText(/would have no date in February/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Schedule it' })).toBeDisabled();
});
