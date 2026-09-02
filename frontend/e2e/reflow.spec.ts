import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * Reflow — WCAG 2.1 AA, 1.4.10 (FRONTEND_STANDARDS §6).
 *
 * The criterion asks that content reflow into **320 CSS pixels** of width without the reader
 * having to scroll sideways to read a line. 320px is not really about phones: it is 1280px at
 * 400% zoom, which is how someone with low vision uses a desktop. The two cases are the same
 * measurement, which is why one viewport answers both.
 *
 * Tables are the stated exception — they need two dimensions to mean anything — so a table is
 * allowed to scroll inside its own container. What is not allowed is the *page* scrolling
 * sideways, which is the thing that makes every line of text unreadable rather than one grid.
 * §3.10 already requires each screen to own its scroll region; this is the check that it does.
 */

const NARROW = { width: 320, height: 640 };

async function pageScrollsSideways(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // A pixel of slack: sub-pixel layout rounds, and a 0.5px overhang is not a reflow failure.
    return {
      overflowBy: doc.scrollWidth - doc.clientWidth,
      // Whatever is actually sticking out, so a failure names the culprit instead of the symptom.
      widest: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)}`),
    };
  });
}

const PUBLIC_PAGES = [
  ['sign in', '/login'],
  ['open data', '/open-data'],
  ['file a complaint', '/complaints/file'],
] as const;

const OPERATOR_PAGES = [
  ['dashboard', '/'],
  ['returns', '/submissions'],
  ['agents', '/agents'],
  ['revenue and levy', '/levy'],
] as const;

test.use({ viewport: NARROW });

for (const [name, path] of PUBLIC_PAGES) {
  test(`${name} reflows into 320px`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { overflowBy, widest } = await pageScrollsSideways(page);
    expect(
      overflowBy,
      `page overflows by ${overflowBy}px. Widest: ${widest.join(', ')}`,
    ).toBeLessThanOrEqual(1);
  });
}

test.describe('signed in as an operator', () => {
  test.use({ storageState: sessionFile('operator') });

  for (const [name, path] of OPERATOR_PAGES) {
    test(`${name} reflows into 320px`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { overflowBy, widest } = await pageScrollsSideways(page);
      expect(
        overflowBy,
        `page overflows by ${overflowBy}px. Widest: ${widest.join(', ')}`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test('a wide table scrolls inside itself, not the page', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    // The exception the criterion allows, used the way it is meant to be used: the table's own
    // container takes the sideways scroll so the page does not.
    const wrapper = await page
      .locator('table')
      .first()
      .evaluate((table) => {
        for (let el = table.parentElement; el; el = el.parentElement) {
          const overflowX = getComputedStyle(el).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll') {
            return { found: true, overflows: el.scrollWidth > el.clientWidth };
          }
        }
        return { found: false, overflows: false };
      });

    expect(wrapper.found, 'the table has no horizontal scroll container of its own').toBe(true);

    const { overflowBy, widest } = await pageScrollsSideways(page);
    expect(
      overflowBy,
      `the page scrolls sideways instead of the table. Widest: ${widest.join(', ')}`,
    ).toBeLessThanOrEqual(1);
  });
});
