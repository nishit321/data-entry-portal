import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The longest list in the portal, at its largest page.
 *
 * `DataTable` virtualises above sixty rows: it renders the window you can see plus a little
 * overscan, and pads the rest with two spacer rows. That is the right trade for a screen, and it
 * is why a hundred-row page stays responsive.
 *
 * That trade looks like it should cost printing: rows React never rendered cannot appear on a
 * sheet, and no stylesheet can bring back an element that does not exist. It does not, and the
 * reason is indirect enough to be worth writing down.
 *
 * The table measures its own scroll viewport with a `ResizeObserver` and sizes the virtual window
 * from it. Under print media the print stylesheet in `index.css` unclips the layout, and the
 * viewport stops being the height of a scroll box and becomes the height of the content. Measured
 * on the agent register at a hundred rows: `clientHeight` goes from 335px to 5,344px, the window
 * grows to cover every row, and React renders them all before the sheet is drawn.
 *
 * **No single rule in that stylesheet is responsible.** Removing the `overflow: visible` block
 * changes nothing; removing the `height: auto` block changes nothing; removing the whole
 * `@media print` section breaks it. They compose, which means nobody reading any one of them would
 * know it was load-bearing for printing a long list.
 *
 * That is the whole reason this file exists. The print stylesheet and the virtualisation were
 * written months apart for unrelated reasons, and the property they produce together is held
 * nowhere else.
 */
test.use({ storageState: sessionFile('operator') });

/*
 * A generous ceiling, deliberately.
 *
 * This runs on a developer machine and in CI, against a production build, on hardware nobody
 * controls. A tight budget would fail for reasons that have nothing to do with the table, and a
 * test that cries wolf gets deleted. What it guards is the order of magnitude.
 */
const BUDGET_MS = 3000;

/** The demo register: 250 agents on one operator, so a page of 100 is a real page. */
const FULL_PAGE = 100;

test('keeps the rendered rows small on a full page', async ({ page }) => {
  await page.goto('/agents?pageSize=100');
  await expect(page.getByRole('heading', { name: /agents/i })).toBeVisible();

  /*
   * Counted with a CSS selector, not a role query.
   *
   * `getByRole('row')` walks Playwright's accessibility tree, which on a long table takes longer
   * than the render it is meant to be measuring.
   */
  const rows = page.locator('tbody tr');
  await expect.poll(() => rows.count(), { timeout: BUDGET_MS }).toBeGreaterThan(0);

  const rendered = await rows.count();
  // eslint-disable-next-line no-console -- the measurement is the output
  console.log(`agent register: ${rendered} of ${FULL_PAGE} rows in the DOM`);

  // Far fewer than the page holds: that is virtualisation doing its job.
  expect(rendered).toBeLessThan(FULL_PAGE);
});

test('prints the whole page, not the part that was on screen', async ({ page }) => {
  /*
   * The claim that matters, and the one CSS alone cannot deliver.
   *
   * `emulateMedia` switches the stylesheet, which is what a browser does when it prepares a
   * printout. If the table still holds only its scroll window at that moment, the sheet that comes
   * out of the printer is missing most of the register and looks complete.
   */
  await page.goto('/agents?pageSize=100');
  const rows = page.locator('tbody tr');
  await expect.poll(() => rows.count(), { timeout: BUDGET_MS }).toBeGreaterThan(0);

  await page.emulateMedia({ media: 'print' });

  await expect.poll(() => rows.count(), { timeout: BUDGET_MS }).toBe(FULL_PAGE);

  // And the last one is a real row with real text, not a spacer.
  await expect(rows.last()).toHaveText(/AG-\d{4}/);
});

test('goes back to a small window once printing is over', async ({ page }) => {
  // Printing must not leave the screen rendering a thousand rows for the rest of the session.
  await page.goto('/agents?pageSize=100');
  const rows = page.locator('tbody tr');
  await expect.poll(() => rows.count(), { timeout: BUDGET_MS }).toBeGreaterThan(0);

  await page.emulateMedia({ media: 'print' });
  await expect.poll(() => rows.count(), { timeout: BUDGET_MS }).toBe(FULL_PAGE);

  await page.emulateMedia({ media: 'screen' });
  await expect.poll(() => rows.count(), { timeout: BUDGET_MS }).toBeLessThan(FULL_PAGE);
});
