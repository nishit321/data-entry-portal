import { expect, test } from '@playwright/test';

/**
 * The public open-data page, filtered and downloaded (NCA, 15 September 2026).
 *
 * "Public Portal: Implement filtering and search capabilities; enable export to PDF, Excel, and
 *  other formats."
 *
 * The API tests hold the rules about what may be published and what must be withheld. What is
 * measured here is the half those cannot see: that a reader with no account can actually narrow
 * the page down and carry the result away, and that what they carry away agrees with what they
 * were looking at.
 *
 * Read by people outside the Authority, which is why one of these tests is about a sentence rather
 * than a control. A withheld period is the portal's most easily misread piece of information: it
 * looks exactly like nothing happened, and a figure the Authority deliberately did not publish is
 * worth nothing if it gets quoted as zero.
 */
test.describe('the public open-data page', () => {
  // No account. That is the whole point of the page, and a signed-in session would test a route
  // nobody using it takes.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the published sector figures to a visitor with no account', async ({ page }) => {
    await page.goto('/open-data');

    await expect(page.getByRole('heading', { name: 'Sector figures' })).toBeVisible();
    await expect(page.getByText('Mobile subscribers')).toBeVisible();
    await expect(page.getByText('Urban population covered')).toBeVisible();
  });

  test('narrows the page to the figure a reader is looking for', async ({ page }) => {
    await page.goto('/open-data');
    await expect(page.getByText('Mobile subscribers')).toBeVisible();

    await page.getByLabel('Find a figure').fill('urban');

    await expect(page.getByText('Urban population covered')).toBeVisible();
    await expect(page.getByText('Mobile subscribers')).toBeHidden();

    // And back, so a reader is never stuck with a filter they cannot undo.
    // "Clear filters", not "Clear": the search box has its own clear control, and two buttons a
    // finger apart both saying the same word is a question the reader has to stop and answer.
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByText('Mobile subscribers')).toBeVisible();
  });

  test('says so when nothing published matches', async ({ page }) => {
    await page.goto('/open-data');
    await page.getByLabel('Find a figure').fill('nothing is called this');

    // Worded for the filtered case. "Nothing has been published yet" would be untrue here, and a
    // reader who saw it would leave thinking the Authority publishes nothing at all.
    await expect(page.getByText(/Nothing published matches/)).toBeVisible();
  });

  test('narrows to a range of periods', async ({ page }) => {
    await page.goto('/open-data');
    await expect(page.getByText('Mobile subscribers')).toBeVisible();

    // The range is chosen by period, because only closed periods are ever published and a free
    // date picker would offer ranges with nothing in them.
    await page.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: '2025 Q4' }).click();

    // The earlier quarter drops out of the series; the figure itself stays on the page.
    await expect(page.getByText('Mobile subscribers')).toBeVisible();
    await expect(page.getByText('Downloads cover what is shown here.')).toBeVisible();
  });

  test('explains a period it withheld, rather than showing a gap', async ({ page }) => {
    /*
     * Capital investment is reported by one operator in the seeded data, which is below the
     * threshold, so every period of it is withheld. The page has to say why: a dash with no
     * explanation reads as nil, and nil is a claim about the sector that nobody made.
     */
    await page.goto('/open-data');
    await page.getByLabel('Find a figure').fill('capital');

    await expect(page.getByText('Capital investment')).toBeVisible();
    await expect(page.getByText(/Periods shown as a dash are not published/)).toBeVisible();
    await expect(page.getByText(/point at a named company/)).toBeVisible();
  });

  test('downloads the figures as a spreadsheet and as a document', async ({ page }) => {
    await page.goto('/open-data');
    await expect(page.getByText('Mobile subscribers')).toBeVisible();

    const excel = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Excel' }).click();
    expect((await excel).suggestedFilename()).toMatch(/^sector-figures-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const pdf = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF' }).click();
    expect((await pdf).suggestedFilename()).toMatch(/^sector-figures-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test('downloads the filtered view, not the whole sector', async ({ page }) => {
    /*
     * The one that would matter once the file has left the page.
     *
     * A spreadsheet of one filtered figure that looks like the whole sector is how a partial number
     * gets quoted as a total, so the request the button makes has to carry the same filter the
     * screen is showing. Checked on the request rather than in the file, because what the file
     * then contains is settled by the API tests.
     */
    await page.goto('/open-data');
    await page.getByLabel('Find a figure').fill('urban');
    await expect(page.getByText('Mobile subscribers')).toBeHidden();

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/public/indicators.xlsx')),
      page.getByRole('button', { name: 'Excel' }).click(),
    ]);
    expect(new URL(request.url()).searchParams.get('search')).toBe('urban');
  });
});
