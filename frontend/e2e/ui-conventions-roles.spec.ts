import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The same conventions, for the roles that are not an Authority administrator.
 *
 * Every earlier sweep signed in as an administrator, which is the one account that sees almost
 * everything and therefore the one account whose coverage is easiest to mistake for complete. An
 * operator's dashboard, their returns, their own users: none of it had been measured.
 *
 * The routes are read from each role's own navigation rather than listed here, so a screen added
 * to the sidebar is swept from the day it appears instead of the day somebody remembers to add it.
 */
test.setTimeout(240_000);

/** Whatever this role can actually reach, as the product itself advertises it. */
async function navRoutes(page: Page): Promise<string[]> {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href]'))
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/') && !href.includes('#')),
  );

  // `/profile` is reachable from the account menu rather than the sidebar, and it carries a form.
  return [...new Set([...hrefs, '/profile'])];
}

/** Read all three conventions out of the current page in one pass. */
async function auditPage(page: Page) {
  return page.evaluate(() => {
    const visible = (el: HTMLElement) => el.offsetParent !== null && el.getClientRects().length > 0;
    const norm = (s: string) =>
      s
        .replace(/\s*\*$/, '')
        .trim()
        .toLowerCase();

    const nameOf = (el: HTMLElement): string => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) return document.getElementById(labelledBy)?.textContent?.trim() ?? '';
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      return el.closest('label')?.textContent?.trim() ?? '';
    };

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]), textarea, select, [role="combobox"]',
      ),
    ).filter(visible);

    const unnamed: string[] = [];
    const repeats: string[] = [];
    for (const el of controls) {
      const name = nameOf(el);
      if (!name) {
        unnamed.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`);
        continue;
      }
      const placeholder = (el as HTMLInputElement).placeholder?.trim();
      if (placeholder && norm(placeholder) === norm(name)) repeats.push(`"${placeholder}"`);
    }

    // Controls that render on one row must line up on that row.
    const rows = new Map<number, { name: string; top: number }[]>();
    for (const el of controls) {
      const box = el.getBoundingClientRect();
      if (box.height === 0) continue;
      if (el.getAttribute('type') === 'checkbox' || el.getAttribute('type') === 'radio') continue;
      const key = Math.round(box.top / 12);
      const near = [key - 1, key, key + 1].find((k) => rows.has(k));
      const entry = { name: nameOf(el) || el.tagName.toLowerCase(), top: box.top };
      if (near !== undefined) rows.get(near)!.push(entry);
      else rows.set(key, [entry]);
    }

    const misaligned: string[] = [];
    for (const group of rows.values()) {
      if (group.length < 2) continue;
      const tops = group.map((g) => g.top);
      const drift = Math.max(...tops) - Math.min(...tops);
      if (drift > 1) {
        misaligned.push(`${group.map((g) => g.name).join(' | ')} differ by ${drift.toFixed(1)}px`);
      }
    }

    return { unnamed, repeats, misaligned };
  });
}

for (const role of ['operator', 'checker'] as const) {
  test.describe(`as ${role}`, () => {
    test.use({ storageState: sessionFile(role) });

    test('labels, placeholders and row alignment hold on every screen this role can open', async ({
      page,
    }) => {
      const routes = await navRoutes(page);
      expect(routes.length, `${role} has screens to check`).toBeGreaterThan(2);

      // Say how much ground was covered. A sweep that silently visited two screens and passed is
      // worse than no sweep, because it reads as assurance.
      console.log(`${role}: sweeping ${routes.length} screens: ${routes.join(' ')}`);

      const offenders: string[] = [];
      for (const route of routes) {
        await page.goto(route);
        await expect(page.getByRole('main')).toBeVisible();
        await page.waitForLoadState('networkidle').catch(() => undefined);

        const { unnamed, repeats, misaligned } = await auditPage(page);
        unnamed.forEach((u) => offenders.push(`${route}: no accessible name: ${u}`));
        repeats.forEach((r) => offenders.push(`${route}: placeholder repeats label: ${r}`));
        misaligned.forEach((m) => offenders.push(`${route}: row not aligned: ${m}`));
      }

      expect(offenders, `${role} screens`).toEqual([]);
    });
  });
}
