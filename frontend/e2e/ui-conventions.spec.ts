import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * A sweep of the UI conventions across every screen an administrator can reach.
 *
 * Static analysis has been tried and it is not enough. A grep can see that a control has an
 * `aria-label`; it cannot see that two controls meant to sit side by side are a line apart, or
 * that a placeholder repeats the label it sits under. Both of those have shipped here before, and
 * both were found only by measuring a real layout — so this spec measures.
 *
 * Each check reports *every* offender rather than failing on the first, because the point is a
 * list to work from, not a single stop.
 */
test.use({ storageState: sessionFile('admin') });

/** Every authenticated screen an Authority administrator can open without an id in the path. */
const ROUTES = [
  '/',
  '/agents',
  '/analytics',
  '/api-credentials',
  '/audit',
  '/benchmarking',
  '/complaints',
  '/documents',
  '/enforcement',
  '/entities',
  '/levy',
  '/network-feeds',
  '/network-map',
  '/notifications',
  '/open-data',
  '/open-data-admin',
  '/profile',
  '/reference-data',
  '/reporting-periods',
  '/scheduled-reports',
  '/signing-certificates',
  '/submissions',
  '/system',
  '/templates',
  '/users',
];

/** Give the screen a moment to finish its first data load before measuring anything. */
async function settle(page: Page) {
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

test.describe('UI conventions', () => {
  test('every form control has an accessible name', async ({ page }) => {
    const offenders: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);

      const unnamed = await page.evaluate(() => {
        const out: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          'input:not([type=hidden]), select, textarea, [role="combobox"], [role="searchbox"]',
        );
        for (const el of Array.from(controls)) {
          if (el.offsetParent === null) continue; // not on screen
          const byAria = el.getAttribute('aria-label')?.trim();
          const byLabelledBy = el.getAttribute('aria-labelledby');
          const byLabel = el.id
            ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim()
            : null;
          const byWrapper = el.closest('label')?.textContent?.trim();
          if (byAria || byLabelledBy || byLabel || byWrapper) continue;
          out.push(
            `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''}` +
              `${el.id ? `#${el.id}` : ''}`,
          );
        }
        return out;
      });

      unnamed.forEach((u) => offenders.push(`${route}: ${u}`));
    }

    expect(offenders, 'controls with no accessible name').toEqual([]);
  });

  test('no placeholder merely repeats its own label', async ({ page }) => {
    const offenders: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);

      const repeats = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'),
        )) {
          const placeholder = el.placeholder?.trim();
          if (!placeholder || el.offsetParent === null) continue;
          const label =
            (el.id
              ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
              : null) ??
            el.getAttribute('aria-label') ??
            '';
          const norm = (s: string) =>
            s
              .replace(/\s*\*$/, '')
              .trim()
              .toLowerCase();
          if (label && norm(label) === norm(placeholder)) out.push(`"${placeholder}"`);
        }
        return out;
      });

      repeats.forEach((r) => offenders.push(`${route}: ${r}`));
    }

    expect(offenders, 'placeholders that repeat their label').toEqual([]);
  });

  test('controls sharing a row line up with each other', async ({ page }) => {
    const offenders: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);

      const misaligned = await page.evaluate(() => {
        const out: string[] = [];
        // Group every visible control by the row it renders on, then check each group agrees.
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, [role="combobox"]',
          ),
        ).filter((el) => el.offsetParent !== null);

        const rows = new Map<number, { el: HTMLElement; top: number }[]>();
        for (const el of controls) {
          const r = el.getBoundingClientRect();
          if (r.height === 0) continue;
          // Bucket by centre line, 12px tolerance, so genuinely stacked fields never pair up.
          const key = Math.round(r.top / 12);
          for (const k of [key - 1, key, key + 1]) {
            if (rows.has(k)) {
              rows.get(k)!.push({ el, top: r.top });
              break;
            }
          }
          if (![key - 1, key, key + 1].some((k) => rows.has(k)))
            rows.set(key, [{ el, top: r.top }]);
        }

        for (const group of rows.values()) {
          if (group.length < 2) continue;
          const tops = group.map((g) => g.top);
          const drift = Math.max(...tops) - Math.min(...tops);
          if (drift > 1) {
            const names = group
              .map((g) => g.el.getAttribute('aria-label') ?? g.el.id ?? g.el.tagName)
              .join(', ');
            out.push(`${names} differ by ${drift.toFixed(1)}px`);
          }
        }
        return out;
      });

      misaligned.forEach((m) => offenders.push(`${route}: ${m}`));
    }

    expect(offenders, 'controls on one row that do not line up').toEqual([]);
  });
});
