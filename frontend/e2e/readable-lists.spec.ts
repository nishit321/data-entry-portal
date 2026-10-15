import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The reporting periods list, with a questionnaire name of a realistic length (NCA, 15 October
 * 2026: "Improve UI. Eg Reporting Periods List is not readable - the template names").
 *
 * This is a bug that only existed with the Authority's real data. The demonstration questionnaire
 * is called "Quarterly Operator Return"; the real one is "Questionnaire for Regulatory and
 * Infrastructure Data Tracking", which is fifty-eight characters. Seven columns with no declared
 * widths gave that name as much room as it asked for and took it from everything else.
 *
 * So the test supplies the long name itself rather than hoping the seed has one. A screenshot of
 * the demonstration data would show nothing wrong, which is exactly how this reached the client.
 */
test.use({ storageState: sessionFile('admin') });

const LONG_NAME = 'Questionnaire for Regulatory and Infrastructure Data Tracking';

test('keeps the row readable when the questionnaire has a long name', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/v1/reporting-periods?*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      data: { template: { name: string } }[];
    };
    // Every row, so the column cannot be kept narrow by its neighbours happening to be short.
    for (const row of body.data) row.template.name = LONG_NAME;
    await route.fulfill({ response, json: body });
  });

  await page.goto('/reporting-periods');
  const row = page.getByRole('row').filter({ hasText: 'Questionnaire for' }).first();
  await expect(row).toBeVisible();

  /*
   * What "not readable" turned out to mean, once it was looked at rather than guessed.
   *
   * A first version of this test measured row height, on the theory that a long name would wrap
   * and swell the row. It passed against the old layout, which proved it was measuring nothing:
   * the old table did not wrap, it truncated. Every row read "Questionnaire f..." and nothing
   * else, and the period itself had no column at all. So these measure what was actually wrong.
   */

  // The name, enough of it to read. The old column showed 27% of it.
  const shownOfName = await visibleFraction(row.getByText(/Questionnaire for/).first());
  expect(shownOfName).toBeGreaterThan(0.6);

  /*
   * The dates whole. Found by looking at the screen after this test first passed: the period
   * range had been cut to "01 Jan 2026 to 31 Mar 2..." by a column a rem and a half too narrow,
   * and nothing above measured it. The end year is the one part of a range nobody can guess.
   */
  for (const column of [1, 2]) {
    expect(await visibleFraction(row.locator('td').nth(column))).toBeGreaterThan(0.99);
  }

  // Every heading whole. A crushed column announces itself here first: "ACTIO..." is the heading
  // of a column that has been squeezed past the width of the word that names it.
  const clippedHeadings = await page
    .getByRole('columnheader')
    .evaluateAll((cells) =>
      cells
        .filter((c) => c.scrollWidth > c.clientWidth + 1)
        .map((c) => (c.textContent ?? '').trim()),
    );
  expect(clippedHeadings).toEqual([]);

  // Every action whole, inside its cell. A button cut off at the edge is a button nobody can find.
  const actions = row.locator('td').last();
  const overflow = await actions.evaluate((td) => td.scrollWidth - td.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('leads with the period, not the questionnaire', async ({ page }) => {
  /*
   * Somebody scanning this list is looking for "2026 Q1". The questionnaire name is usually the
   * same on every row, so leading with it meant the one thing that differed between rows was the
   * hardest to find.
   */
  await page.goto('/reporting-periods');
  const firstHeader = page.getByRole('columnheader').first();
  await expect(firstHeader).toHaveText(/Period/);

  // The questionnaire is still there, underneath, where it reads as context rather than identity.
  const firstRow = page.getByRole('row').nth(1);
  await expect(firstRow).toContainText(/v\d/);
});

/**
 * How much of an element's text is actually on screen, from 0 to 1.
 *
 * The text's natural width against the width of whatever is clipping it. Two traps, both of which
 * this helper fell into before it worked:
 *
 * The element's own box is no use. Text often sits in an inline span, whose clientWidth is always
 * zero, so a ratio taken from it is NaN and fails for a reason that proves nothing.
 *
 * Nor is a Range over the element's contents, if the element is a wrapper. A table cell here holds
 * a tooltip wrapper, which holds the clipping div, which holds the text; a Range over the wrapper
 * measures the clipping div's box - the width you can see - and reports every cell as fully
 * visible. So the Range is set on the text nodes themselves, whose laid-out width is the full
 * width even where an ellipsis hides the end of it.
 */
function visibleFraction(locator: import('@playwright/test').Locator): Promise<number> {
  return locator.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        (n.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    if (texts.length === 0) return 1;

    const range = document.createRange();
    range.setStart(texts[0]!, 0);
    const last = texts[texts.length - 1]!;
    range.setEnd(last, last.length);
    const natural = range.getBoundingClientRect().width;
    if (natural === 0) return 1;

    let clipper: Element | null = texts[0]!.parentElement;
    while (clipper && window.getComputedStyle(clipper).overflowX === 'visible') {
      clipper = clipper.parentElement;
    }
    if (!clipper) return 1;
    const style = window.getComputedStyle(clipper);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    return Math.min(1, (clipper.clientWidth - padding) / natural);
  });
}
