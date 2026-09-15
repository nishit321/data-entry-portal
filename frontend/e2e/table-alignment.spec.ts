import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Does every column's header sit over its own data?
 *
 * This has to be a browser test, for the same reason `field-alignment.spec.ts` gives: jsdom
 * reports every box as zero by zero, so a unit test can assert a column is aligned and mean
 * nothing by it. Only a real layout can answer it, and the answer is a number.
 *
 * It measures the *text* box rather than the cell box. A header and its cell can share a `<th>`
 * and `<td>` of identical width and still look wrong, because what a reader lines up is where the
 * words start — and that is decided by the padding and the display of whatever wraps the text
 * inside the cell.
 */
test.use({ storageState: sessionFile('admin') });

/** The tables an Authority administrator can reach, and the column count each should show. */
const TABLES = [
  { name: 'Entities', path: '/entities' },
  { name: 'Agents', path: '/agents' },
  { name: 'Users', path: '/users' },
  { name: 'Templates', path: '/templates' },
  { name: 'Reporting periods', path: '/reporting-periods' },
  { name: 'Reference data', path: '/reference-data' },
  { name: 'Submissions', path: '/submissions' },
  { name: 'Audit log', path: '/audit' },
];

/**
 * Where a cell's content begins, in page coordinates.
 *
 * The leftmost edge of everything the cell draws, not the first character. A status column holds a
 * pill, and a pill insets its own text by its padding — so measuring the text would report the
 * column as misaligned when what the reader lines up, the badge's edge, is exactly where it should
 * be. Off-flow boxes are skipped: a screen-reader-only span is positioned absolutely and clipped
 * to a pixel, and it is not on screen to line up with anything.
 */
async function contentEdge(
  page: Page,
  selector: string,
  index: number,
  edge: 'left' | 'right',
): Promise<number | null> {
  return page.evaluate(
    ({ selector, index, edge }) => {
      const cell = document.querySelectorAll(selector)[index] as HTMLElement | undefined;
      if (!cell) return null;

      const edges: number[] = [];

      for (const el of Array.from(cell.querySelectorAll<HTMLElement>('*'))) {
        const style = getComputedStyle(el);
        if (style.position === 'absolute' || style.position === 'fixed') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) edges.push(edge === 'left' ? rect.left : rect.right);
      }

      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue;
        const parent = node.parentElement;
        if (parent && getComputedStyle(parent).position === 'absolute') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) edges.push(edge === 'left' ? rect.left : rect.right);
      }

      return edges.length > 0 ? (edge === 'left' ? Math.min(...edges) : Math.max(...edges)) : null;
    },
    { selector, index, edge },
  );
}

for (const table of TABLES) {
  test(`${table.name}: every header sits over its column`, async ({ page }) => {
    await page.goto(table.path);

    // Wait for the list to settle before counting anything. Counting straight after `goto` reads
    // the skeleton, finds no rows, and skips every table on the way past — which is exactly what
    // this spec did on its first run.
    const firstRow = page.locator('table tbody tr:not([aria-hidden])').first();
    const emptyState = page.getByText(/^(No |Nothing )/);
    await expect(firstRow.or(emptyState).first()).toBeVisible();

    // An empty table has nothing to line a header up against. Skipping says so out loud rather
    // than passing quietly, so the gap shows in the run and closes itself the day the seed grows
    // a row for this screen.
    const rowCount = await page.locator('table tbody tr:not([aria-hidden])').count();
    test.skip(rowCount === 0, `no seeded rows on ${table.path} to measure against`);

    const headers = await page.locator('table thead th').count();
    expect(headers).toBeGreaterThan(1);

    const offenders: string[] = [];

    for (let i = 0; i < headers; i += 1) {
      // A right-aligned column lines up on its right edge; comparing left edges there would
      // report "ACTIONS" as misaligned simply because three icons are wider than the word.
      const align = await page
        .locator('table thead th')
        .nth(i)
        .evaluate((el) => getComputedStyle(el).textAlign);
      const edge = align === 'right' || align === 'end' ? 'right' : 'left';

      const head = await contentEdge(page, 'table thead th', i, edge);
      const body = await contentEdge(page, 'table tbody tr:not([aria-hidden]) td', i, edge);

      // A cell with no text of its own (a checkbox, an icon-only action) has nothing to line up.
      if (head === null || body === null) continue;

      const drift = Math.abs(head - body);
      // One pixel for sub-pixel rounding, and no more. Anything above that is visible.
      if (drift > 1) {
        const label = await page.locator('table thead th').nth(i).innerText();
        offenders.push(
          `${label.trim() || `column ${i}`} (${edge} edge): header ${head}, data ${body}, off by ${drift}`,
        );
      }
    }

    expect(offenders, `misaligned columns on ${table.path}`).toEqual([]);
  });
}
