import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * What comes out of the printer.
 *
 * A regulator prints a filed return to put in a case file, and a filtered audit view to attach to
 * a letter. Both were coming out with the navigation down the side, a search box and a row of
 * buttons nobody can press on paper — and, worse, with nothing on the sheet to say what it was.
 *
 * Playwright can emulate the print media type, which makes this checkable rather than a thing
 * somebody eyeballs once. A print stylesheet nobody tests is one that quietly stops matching the
 * app the first time a screen is restructured.
 */
test.use({ storageState: sessionFile('admin') });

test.describe('the audit trail, on paper', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('main')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
  });

  test('drops the parts of the screen a sheet of paper has no use for', async ({ page }) => {
    // The navigation is the clearest of these: on paper it is a list of words that do nothing.
    await expect(page.getByRole('navigation').first()).toBeHidden();

    /*
     * Counted through the DOM rather than by role. A role query skips anything the accessibility
     * tree cannot see, so once the stylesheet has done its job `getByRole('button')` finds
     * nothing — and a test asserting "no visible buttons" would pass just as well on a page that
     * never had any.
     */
    const total = await page.locator('button').count();
    const visible = await page
      .locator('button')
      .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);
    expect(total).toBeGreaterThan(0);
    expect(visible).toBe(0);
  });

  test('says what it is, who took it and when', async ({ page }) => {
    /*
     * The part that matters most and is easiest to leave out. Without it the sheet is a table of
     * rows that could have come from anywhere, on any day — which is no use in a case file and no
     * use in a dispute.
     */
    const header = page.locator('.print-header');
    await expect(header).toBeVisible();
    await expect(header).toContainText('National Communications Authority');
    // Whatever the screen is called in the navigation — the header takes its title from the
    // same place the browser tab does, so the two cannot drift apart.
    await expect(header).toContainText('Audit log');
    await expect(header).toContainText(/Printed \d{1,2} \w+ \d{4}/);
    // The account that took it, so a printed page is attributable like everything else here.
    await expect(header).toContainText(/by \S+/);
  });

  test('is hidden again the moment it is back on screen', async ({ page }) => {
    // A duplicate title above every page would be a daily annoyance for a once-a-month need.
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('.print-header')).toBeHidden();
  });

  test('lets the content run down the page instead of scrolling inside a box', async ({ page }) => {
    /*
     * The list screens fill the viewport and scroll inside themselves, which is right on screen
     * and means exactly one sheet of paper otherwise: everything below the fold sits inside an
     * overflow that never prints.
     *
     * Asserted as a *difference* between the two media, not as an absolute. "Nothing scrolls in
     * print" would also be satisfied by a page that had no scrolling container to begin with —
     * a test that cannot fail. Checking that one exists on screen and is gone on paper is the
     * claim actually being made.
     */
    const clippers = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll('body *')].filter((node) => {
            const el = node as HTMLElement;
            // Something already hidden clips nothing.
            if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
            const style = getComputedStyle(el);
            return ['auto', 'scroll', 'hidden'].includes(style.overflowY);
          }).length,
      );

    await page.emulateMedia({ media: 'screen' });
    expect(await clippers()).toBeGreaterThan(0);

    await page.emulateMedia({ media: 'print' });
    expect(await clippers()).toBe(0);
  });

  test('repeats table headings on every sheet', async ({ page }) => {
    /*
     * A table that breaks across a page leaves the reader with a column of values and nothing to
     * say what they are.
     *
     * `table-header-group` is already the browser default, so this is not testing the stylesheet
     * so much as guarding the default: making a table responsive by setting `display: block` on
     * its parts is a common enough trick, and it silently ends the repetition. Worth a line to
     * find out here rather than from a printed page.
     */
    const head = page.locator('thead').first();
    await expect(head).toHaveCount(1);
    await expect(head).toHaveCSS('display', 'table-header-group');
  });
});
