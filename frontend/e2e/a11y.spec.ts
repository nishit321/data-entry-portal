import { expect, test } from '@playwright/test';
import { report, scan } from './axe';
import { sessionFile } from './helpers';

/**
 * Accessibility as painted (FRONTEND_STANDARDS §6).
 *
 * The jsdom suite already runs axe over every primitive, and had to switch off `color-contrast`
 * there: jsdom has no cascade, so every colour resolves to a browser default and the rule would
 * only ever be reporting on jsdom. `src/lib/contrast.test.ts` covers the palette instead, which is
 * the right check for a palette and cannot see a page.
 *
 * This is the page. Real Chromium, the production build, the tokens actually painted — so
 * `color-contrast` runs here, on the real thing, with everything composed and overlapping as the
 * operator sees it.
 *
 * The return editor is checked in `journey.spec.ts` instead: there is one open reporting
 * period, so whichever test opens a draft first takes it. Scanning it there means it is scanned
 * with real answers in it, and nothing races for the period.
 */

const PUBLIC_PAGES = [
  ['sign in', '/login'],
  ['open data', '/open-data'],
  ['file a complaint', '/complaints/file'],
] as const;

for (const [name, path] of PUBLIC_PAGES) {
  test(`${name} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { violations } = await scan(page);
    expect(violations, report(violations)).toEqual([]);
  });
}

const OPERATOR_PAGES = [
  ['dashboard', '/'],
  ['returns', '/submissions'],
  ['agents', '/agents'],
  ['documents', '/documents'],
  ['revenue and levy', '/levy'],
] as const;

test.describe('signed in as an operator', () => {
  test.use({ storageState: sessionFile('operator') });

  for (const [name, path] of OPERATOR_PAGES) {
    test(`${name} has no accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { violations } = await scan(page);
      expect(violations, report(violations)).toEqual([]);
    });
  }
});
