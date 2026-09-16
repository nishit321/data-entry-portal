import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Exporting a filtered list to a spreadsheet.
 *
 * `lib/csv.ts` has been generic since the design pass and only the audit log used it. Submissions
 * and the review queue do now, through one hook, so the three screens cannot drift apart in the
 * one place it would matter: what a reader is told when the export comes back **capped**.
 *
 * Three things only a browser can answer here:
 *
 *  1. A file actually arrives. A download built from a blob is a chain of five things and any of
 *     them can be right on its own while the chain produces nothing.
 *  2. It carries the filters the screen has applied, rather than the whole table.
 *  3. Nothing to export says so, rather than handing over a file of column headers.
 */
test.use({ storageState: sessionFile('admin') });

test('hands over a file named for what is in it', async ({ page }) => {
  await page.goto('/submissions');
  await expect(page.getByRole('heading', { name: /returns/i })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();

  // `submissions-2026-09-16.csv`: the subject and the day it was taken, so two exports a week
  // apart stay tellable apart in a downloads folder.
  expect((await download).suggestedFilename()).toMatch(/^submissions-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('exports what the filters left, not the whole table', async ({ page }) => {
  /*
   * The claim that makes an export trustworthy. A file that silently ignores the filters is worse
   * than no export: somebody reconciles against it and reaches a conclusion about rows they never
   * asked to see.
   *
   * Read by counting the lines that came back, against a filter narrow enough to change the
   * answer.
   */
  await page.goto('/submissions');
  await expect(page.getByRole('heading', { name: /returns/i })).toBeVisible();

  const all = await linesFrom(page);

  await page
    .getByRole('combobox', { name: /status/i })
    .first()
    .click();
  await page.getByRole('option', { name: 'Draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();

  const drafts = await linesFrom(page);
  expect(drafts).toBeLessThan(all);
});

test('says so rather than handing over an empty file', async ({ page }) => {
  /*
   * A spreadsheet of column headings and nothing else is a download that worked perfectly and
   * tells the reader nothing, leaving them hunting for what went wrong. Searching for something
   * no return matches is the quickest way to that state.
   */
  await page.goto('/submissions');
  await page.getByRole('searchbox').fill('zzz-no-such-return-zzz');
  await expect(page.getByText(/no returns match/i)).toBeVisible();

  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText(/Nothing to export/i)).toBeVisible();
});

test.describe('the review queue', () => {
  /*
   * The checker's session, not an administrator's.
   *
   * The queue shows returns waiting at *your* stage, so an administrator's is empty and the export
   * correctly refuses to hand over a file of nothing. Run as the role whose screen this is, or the
   * test measures the empty case twice and calls it coverage.
   */
  test.use({ storageState: sessionFile('checker') });

  test('exports with the days each return has waited', async ({ page }) => {
    // The column the queue needs and the table cannot give: "3 days ago" is right for reading and
    // useless for sorting, so the file carries the number.
    await page.goto('/review-queue');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^review-queue-\d{4}-\d{2}-\d{2}\.csv$/);

    const body = await readDownload(file);
    expect(body.split('\r\n')[0]).toContain('Days waiting');
  });
});

/** How many data lines an export produced, header excluded. */
async function linesFrom(page: import('@playwright/test').Page): Promise<number> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const body = await readDownload(await download);
  return body.split('\r\n').filter((l) => l.trim().length > 0).length - 1;
}

async function readDownload(file: import('@playwright/test').Download): Promise<string> {
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
