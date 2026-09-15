import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Fibre routes on the network map (NCA, 15 September 2026).
 *
 * "Network Map: Display the complete fiber route."
 *
 * The API tests hold the rules: whose nodes a route may join, what a survey is, what happens when
 * there is not one. What only a browser can answer is whether the line is actually drawn, and
 * whether the difference between a surveyed route and a straight line survives the trip to the
 * screen.
 *
 * That difference is the reason this file exists. A dashed line and a solid one are the same
 * object to every test that is not looking at pixels, and the whole point is that one of them says
 * "this is where the cable runs" and the other says "these two nodes are joined, somehow". A map
 * that drew them alike would be confidently wrong about where to dig.
 */
test.use({ storageState: sessionFile('operator') });

test('draws the seeded routes, one surveyed and one not', async ({ page }) => {
  await page.goto('/network-map');
  await expect(page.getByRole('heading', { name: /network map/i })).toBeVisible();

  // Leaflet draws a polyline as an SVG path, and so are the coverage rings and the pins, so the
  // routes carry a class of their own. Two are seeded.
  const routes = page.locator('path.nca-fibre-route');
  await expect(routes).toHaveCount(2, { timeout: 15_000 });

  /*
   * One dashed and one solid, which is the assertion this file is for.
   *
   * Read off the painted attribute rather than off the data, because the gap between "the server
   * said surveyed: false" and "the reader sees a dashed line" is exactly what a browser test is
   * for. Both would pass a unit test that only checked the props.
   */
  const dashes = await routes.evaluateAll((paths) =>
    paths.map((p) => p.getAttribute('stroke-dasharray')),
  );
  expect(dashes.filter((d) => d !== null)).toHaveLength(1);
  expect(dashes.filter((d) => d === null)).toHaveLength(1);
});

test('says which of the two the reader is looking at', async ({ page }) => {
  await page.goto('/network-map');
  await expect(page.getByRole('heading', { name: 'Fibre routes' })).toBeVisible();

  // The legend names the dashed line, so a reader does not have to click one to find out.
  await expect(page.getByText('Straight line, not surveyed').first()).toBeVisible();

  // And the register says the same thing in the row, where somebody checks a figure.
  const table = page.getByRole('group', { name: 'Fibre routes' });
  await expect(table).toContainText('Juba to Yei backbone');
  await expect(table).toContainText('Juba to Bor link');
  await expect(table).toContainText('Surveyed');
  await expect(table).toContainText('198.2 km');
});

test('takes the routes off the map when the layer is switched off', async ({ page }) => {
  await page.goto('/network-map');
  const routes = page.locator('path.nca-fibre-route');
  await expect(routes).toHaveCount(2, { timeout: 15_000 });

  await page.getByLabel('Show fibre routes').uncheck();
  await expect(routes).toHaveCount(0);

  await page.getByLabel('Show fibre routes').check();
  await expect(routes).toHaveCount(2);
});

test('refuses a route that starts and ends at the same node', async ({ page }) => {
  /*
   * Said in the form rather than after the request comes back. The server refuses it too, and has
   * a test that says so; what is being held here is that somebody who picks the same node twice
   * finds out before pressing the button rather than after.
   */
  await page.goto('/network-map');
  await page.getByRole('button', { name: 'Add a route' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a fibre route' });

  await dialog.getByLabel('Reference').fill('E2E-LOOP');
  await dialog.getByLabel('Name').fill('Nowhere to nowhere');

  const pick = async (label: string) => {
    await dialog.getByRole('combobox', { name: label }).click();
    await page.getByRole('option', { name: /Juba exchange/ }).click();
  };
  await pick('Node the route starts at');
  await pick('Node the route ends at');

  await expect(dialog.getByText('A route has to join two different nodes.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add the route' })).toBeDisabled();
});
