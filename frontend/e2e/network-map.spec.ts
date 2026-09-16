import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Does the basemap actually appear?
 *
 * This exists because it did not, and nothing said so. The tile server was set in `.env.example`
 * — the file nobody runs — while the `.env` the app reads had no such line, so the map opened on a
 * plain background exactly as it had before. Every check in the repo stayed green: the code was
 * right, the documentation was right, and the running product was wrong.
 *
 * Which is the shape of thing worth a browser test. A tile layer is configuration plus a network
 * request plus a content-security policy, and each of those can be correct on its own while the
 * three together render nothing.
 *
 * The tiles come from a third party, so the request is stubbed rather than made. What is under
 * test is that the map asks for them at all and paints what comes back — not that OpenStreetMap
 * is up, which is not ours to assert and would make this fail on a bad morning.
 */
test.use({ storageState: sessionFile('operator') });

/** A one-pixel PNG, so a stubbed tile is a real image the browser can decode. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('draws a basemap under the network map', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**://*.openstreetmap.org/**', async (route) => {
    asked.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  await page.goto('/network-map');
  await expect(page.getByRole('heading', { name: /network map/i })).toBeVisible();

  // Leaflet gives every tile this class, so their presence is the layer having been added.
  const tiles = page.locator('img.leaflet-tile');
  await expect(tiles.first()).toBeVisible({ timeout: 15_000 });
  expect(asked.length).toBeGreaterThan(0);

  /*
   * Painted, not merely present. An `<img>` whose request was refused — by a content-security
   * policy, or a wrong URL — is still in the DOM and still "visible" to a locator; it is zero
   * pixels wide. That distinction is the whole point of checking this in a browser.
   */
  const drawn = await tiles.first().evaluate((img) => (img as HTMLImageElement).naturalWidth);
  expect(drawn).toBeGreaterThan(0);
});

test('draws the map even when the filters match nothing', async ({ page }) => {
  /*
   * The case this screen used to skip. With nothing to plot, the page showed a grey box where the
   * country should be — so somebody about to type their first coordinates had nothing to check
   * them against, and a deployment with no tile server looked exactly like one with a working map.
   *
   * Reached here by narrowing the filters past anything on the register, which is how a reader
   * actually arrives at it. It used to be reached by signing in as an operator with an empty
   * register; the demo data now gives that operator a network, and a test that can only be run on
   * a brand-new account is a test that stops running.
   */
  await page.route('**://*.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );

  await page.goto('/network-map');
  await page.getByLabel('Show agents').uncheck();
  await page.getByRole('combobox', { name: 'Filter by status' }).click();
  await page.getByRole('option', { name: 'Planned' }).click();

  await expect(page.getByText(/Nothing to map yet/i)).toBeVisible();

  // The guidance sits under the map, not instead of it.
  const tiles = page.locator('img.leaflet-tile');
  await expect(tiles.first()).toBeVisible({ timeout: 15_000 });
});
