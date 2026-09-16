import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Acting on several rows at once.
 *
 * `DataTable` has had a selection column and `ListShell` a selection bar since the design pass;
 * only Users wired the mutations behind them. Agents, Entities and Reference data now do too.
 *
 * What is worth a browser test is not that a checkbox ticks. It is the pair of claims a bulk action
 * makes and a unit test cannot see: that the bar says how many rows it is about to act on, and that
 * pressing it actually changes them. A bar reporting "1 items selected" against four rows, or one
 * that clears the selection and changes nothing, both look fine in jsdom.
 */
test.use({ storageState: sessionFile('admin') });

/*
 * Rows that carry their own checkbox, which is not the same as rows containing one.
 *
 * The header row contains a checkbox too: the select-all. Matching on `checkbox` alone caught it,
 * and `nth(0)` then ticked every row on the page while the test believed it had ticked one.
 */
const selectableRows = (page: import('@playwright/test').Page) =>
  page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Select this row' }) });

/*
 * The selection bar, scoped.
 *
 * Every row carries its own "Deactivate this value" icon button, so asking the page for a button
 * called Deactivate finds eight of them. Scoping to the bar is not a convenience: clicking the
 * wrong one would act on one row while the test believed it had acted on the selection.
 */
const bulkBar = (page: import('@playwright/test').Page) => page.getByRole('status');

// "Deactivate" contains "activate", so the Activate button has to be matched exactly or the two
// resolve together and the click is ambiguous.

test('counts what is selected, in words that work for one', async ({ page }) => {
  /*
   * The count is the whole safety of the thing: it is the only statement of scope before a click
   * changes many records. "1 values selected" is the kind of wrong that makes a reader stop
   * trusting the number, which is worse than the grammar.
   */
  await page.goto('/reference-data');
  const rows = selectableRows(page);
  await expect(rows.first()).toBeVisible();

  await rows.nth(0).getByRole('checkbox', { name: 'Select this row' }).check();
  await expect(page.getByText('1 value selected')).toBeVisible();

  await rows.nth(1).getByRole('checkbox', { name: 'Select this row' }).check();
  await expect(page.getByText('2 values selected')).toBeVisible();
});

test('clears the selection and puts the toolbar back', async ({ page }) => {
  // The way out. Somebody who has ticked forty rows across three pages and changed their mind
  // needs one button, not a scroll back through the list unticking.
  await page.goto('/reference-data');
  const rows = selectableRows(page);
  await expect(rows.first()).toBeVisible();

  await rows.nth(0).getByRole('checkbox', { name: 'Select this row' }).check();
  await expect(page.getByText('1 value selected')).toBeVisible();

  await bulkBar(page).getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('1 value selected')).toBeHidden();
});

test('says what a suspension does before it does it', async ({ page }) => {
  /*
   * An administrator ticking rows is entitled to know that the people behind them stop being able
   * to file, before pressing the button rather than after the first phone call. The dialog names
   * the consequence rather than the status it sets.
   */
  await page.goto('/entities');
  const rows = selectableRows(page);
  await expect(rows.first()).toBeVisible();

  await rows.nth(0).getByRole('checkbox', { name: 'Select this row' }).check();
  await bulkBar(page).getByRole('button', { name: 'Suspend' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('cannot file returns');
  await expect(dialog).toContainText('1 selected');
});

test('actually changes the rows it was pointed at', async ({ page }) => {
  /*
   * The assertion the rest of this file exists to reach.
   *
   * Everything above is about what the screen says. This is whether the action lands: tick a
   * value, deactivate it, and read the row back. A bar that clears the selection and calls nothing
   * looks identical until somebody checks the data.
   *
   * Reference data rather than entities or agents, because a lookup value is the one of the three
   * with no other record depending on its state, so the test can put it back.
   */
  await page.goto('/reference-data');
  const rows = selectableRows(page);
  await expect(rows.first()).toBeVisible();

  const target = rows.first();
  // The second cell, not the first: the first is the checkbox column the table owns. Asserted
  // non-empty, because an empty string here makes `filter({ hasText })` match every row and the
  // test then passes or fails for reasons that have nothing to do with the feature.
  const code = (await target.locator('td').nth(1).innerText()).trim();
  expect(code).not.toBe('');

  await target.getByRole('checkbox', { name: 'Select this row' }).check();
  await bulkBar(page).getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();

  // The row now reads as inactive. Found again by its code, because the list re-sorts on refresh.
  const changed = page.getByRole('row').filter({ hasText: code });
  await expect(changed).toContainText(/inactive/i);

  // Put it back, so a second run of this suite starts where the first one did.
  await changed.getByRole('checkbox', { name: 'Select this row' }).check();
  await bulkBar(page).getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: code })).toContainText(/active/i);
});
