import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';
import { API_URL } from '../playwright.config';

/**
 * A citizen attaching evidence to a complaint (NCA, 15 September 2026).
 *
 * "Public Complaints: Incorporate an attachment upload option."
 *
 * The API tests already hold the rules: what formats are taken, how many, who may read a file
 * back. What they cannot answer is whether the thing works when a person uses it, and that matters
 * more here than on most screens. This is the one page in the portal reached by somebody who has
 * no account, no training and no support number, and the upload is the only part of it that spans
 * two requests. If filing succeeds and the photo silently does not, nobody finds out: the sender
 * sees a receipt and assumes the Authority has what they sent.
 *
 * So what is measured here is the seam. The file goes up as a second call after the complaint is
 * recorded, and each test below asks what the citizen is actually told about it.
 */

/** A real PNG: eight signature bytes and some padding. The server checks the bytes, not the name. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('nca ui evidence fixture'),
]);

const FILING = {
  subject: 'No signal since Monday',
  description:
    'There has been no coverage in my part of Juba since Monday morning and calls do not connect.',
};

test.describe('the public complaint desk', () => {
  // Filed by a member of the public, so no session at all. Signed-in state would prove nothing
  // about the route a citizen actually takes.
  test.use({ storageState: { cookies: [], origins: [] } });

  /** Fill the form and send it, with whatever files were chosen first. */
  async function file(page: import('@playwright/test').Page) {
    await page.getByLabel('Subject').fill(FILING.subject);
    await page.getByLabel('What happened?').fill(FILING.description);
    await page.getByRole('button', { name: 'Send to the Authority' }).click();
    await expect(page.getByText('We have your complaint')).toBeVisible();
  }

  /** The reference and code from the receipt, which is the only place they are ever shown. */
  async function receipt(page: import('@playwright/test').Page) {
    const text = await page.locator('.font-mono').allInnerTexts();
    return { referenceNumber: text[0].trim(), trackingCode: text[1].trim() };
  }

  test('sends a photograph with the complaint, and says so on the receipt', async ({ page }) => {
    await page.goto('/complaints/file');

    // The input is hidden behind a button, as it is on every upload in the portal: a bare file
    // input cannot be styled and reads badly to a screen reader. Playwright sets files on it
    // directly, which is what the button's click would do.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'mast.png',
      mimeType: 'image/png',
      buffer: PNG,
    });

    // Chosen, not yet sent. The citizen can still see what they picked and take it off again.
    await expect(page.getByText('mast.png')).toBeVisible();

    await file(page);

    // The wording is the whole point of this assertion. "Sent" is a claim about what the Authority
    // now holds, and it is only made after the upload call came back.
    await expect(page.getByText('Your file was sent with it.')).toBeVisible();

    const { referenceNumber, trackingCode } = await receipt(page);
    expect(referenceNumber).toMatch(/^NCA\/CMP\/\d{4}\/\d{6}$/);

    // And the citizen coming back later is told the same thing by the server rather than by the
    // page they have just left.
    await page.getByRole('button', { name: 'Check on it' }).click();
    await page.getByLabel('Reference number').fill(referenceNumber);
    await page.getByLabel('Tracking code').fill(trackingCode);
    await page.getByRole('button', { name: 'Check progress' }).click();
    await expect(page.getByText('1 file attached')).toBeVisible();
  });

  test('lets a file be taken off before the complaint is sent', async ({ page }) => {
    await page.goto('/complaints/file');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'mast.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('mast.png')).toBeVisible();

    await page.getByRole('button', { name: 'Remove mast.png' }).click();
    await expect(page.getByText('mast.png')).toBeHidden();

    await file(page);
    // Nothing was attached, so nothing is claimed. A receipt that said a file was sent when the
    // citizen had removed it would be worse than saying nothing at all.
    await expect(page.getByText('was sent with it')).toBeHidden();
  });

  test('files the complaint even when the file cannot be attached', async ({ page }) => {
    /*
     * The failure this design exists for.
     *
     * The upload is a second request, so it can fail on its own: a dropped connection, a file the
     * server refuses. What must not happen is the account of what went wrong being lost with it.
     * The complaint is recorded first, and a file that does not make it is named rather than
     * quietly dropped.
     *
     * Forced here by failing the upload route and nothing else, so the filing itself is untouched.
     */
    await page.route('**/complaints/attachments', (route) => route.abort('failed'));

    await page.goto('/complaints/file');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'mast.png', mimeType: 'image/png', buffer: PNG });
    await file(page);

    // The reference is still issued, and the sender is told plainly which file is missing.
    await expect(page.getByText('could not attach')).toBeVisible();
    await expect(page.getByText('mast.png')).toBeVisible();
    const { referenceNumber } = await receipt(page);
    expect(referenceNumber).toMatch(/^NCA\/CMP\/\d{4}\/\d{6}$/);
  });
});

test.describe('the Authority reading a complaint', () => {
  test.use({ storageState: sessionFile('admin') });

  test('shows the file a citizen sent in, to save rather than to open', async ({ page }) => {
    // File one first, as the public would, so there is something on the case to find.
    // Against the API directly, not the page's baseURL: the preview server serves the built
    // bundle and knows nothing about /api. This is fixture setup, and the citizen's side of it is
    // driven through the browser in the tests above.
    const filing = await page.request.post(`${API_URL}/complaints`, {
      data: {
        category: 'SERVICE_QUALITY',
        subject: 'Evidence attached to this one',
        description: FILING.description,
      },
    });
    const filed = (await filing.json()) as { referenceNumber: string; trackingCode: string };

    const upload = await page.request.post(`${API_URL}/complaints/attachments`, {
      multipart: {
        referenceNumber: filed.referenceNumber,
        trackingCode: filed.trackingCode,
        file: { name: 'mast.png', mimeType: 'image/png', buffer: PNG },
      },
    });
    expect(upload.ok()).toBe(true);

    await page.goto('/complaints');
    await page.getByText('Evidence attached to this one').first().click();

    await expect(page.getByText('Sent in with the complaint')).toBeVisible();
    await expect(page.getByText('mast.png')).toBeVisible();

    // Saved, never rendered in place. These arrive over an unauthenticated route and are stored
    // unscanned, so the page does not decide on the reader's behalf that one is safe to open.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    expect((await download).suggestedFilename()).toBe('mast.png');
  });
});
