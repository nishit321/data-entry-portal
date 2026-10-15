import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The Authority's seal, where the portal says who it belongs to (NCA, 15 October 2026).
 *
 * Before this the portal carried no logo at all: a generic shield icon on the sign-in screen and
 * in the shell, and a blank page icon in the browser tab.
 *
 * The check that matters here is not that an `img` element exists. A wrong path still renders an
 * element, still passes a visibility check, and shows the reader a broken-image glyph. So each of
 * these reads `naturalWidth` back from the browser, which is zero until the file has actually
 * arrived and been decoded.
 */

/** Did the browser really fetch and decode it, or is this a broken-image placeholder? */
async function loaded(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((img) => {
      const el = img as HTMLImageElement;
      return el.complete && el.naturalWidth > 0;
    });
}

test.describe('the sign-in screen', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the seal, and the seal actually loads', async ({ page }) => {
    await page.goto('/login');
    const seal = page.locator('img[src="/brand/nca-logo.png"]').first();
    await expect(seal).toBeVisible();
    expect(await loaded(page, 'img[src="/brand/nca-logo.png"]')).toBe(true);
  });

  test('names the Authority the way the seal does', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByText('National Communication Authority, Republic of South Sudan'),
    ).toBeVisible();
  });

  test('puts the seal in the browser tab', async ({ page, request }) => {
    /*
     * The tab icon is the one piece of branding nobody sees in a screenshot of the app, and the
     * one most likely to be left as the framework default for ever. Asserting the `link` tag alone
     * would pass with the file missing, so the file is fetched too.
     */
    await page.goto('/login');
    const href = await page.locator('link[rel="icon"][sizes="any"]').getAttribute('href');
    expect(href).toBe('/favicon.ico');

    const icon = await request.get(new URL(href!, page.url()).toString());
    expect(icon.status()).toBe(200);
    expect(Number(icon.headers()['content-length'] ?? 0)).toBeGreaterThan(0);
  });
});

test.describe('the signed-in shell', () => {
  test.use({ storageState: sessionFile('admin') });

  test('carries the same seal as the sign-in screen', async ({ page }) => {
    // The same file, not a second copy that can drift away from it.
    await page.goto('/');
    await expect(page.locator('img[src="/brand/nca-logo.png"]').first()).toBeVisible();
    expect(await loaded(page, 'img[src="/brand/nca-logo.png"]')).toBe(true);
  });

  test('stamps the right name on anything printed', async ({ page }) => {
    /*
     * The print header is hidden on screen and revealed by the print stylesheet, so it is in the
     * DOM to be read even though nobody can see it. It used to say "National Communications
     * Authority", which is not the Authority's name, on every sheet that went into a case file.
     */
    await page.goto('/');
    const header = page.locator('.print-header').first();
    await expect(header).toHaveText(/National Communication Authority/);
    await expect(header).not.toHaveText(/National Communications Authority/);
  });

  test('keeps the print header off the screen', async ({ page }) => {
    // It is a second copy of the page title. Visible, it would read as a duplicate heading on
    // every screen in the product.
    await page.goto('/');
    await expect(page.locator('.print-header').first()).toBeHidden();
  });
});
