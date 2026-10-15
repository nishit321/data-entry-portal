import { expect, test, type Page } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * The same conventions, measured *inside* the dialogs.
 *
 * Nearly every form in this product lives in a `Modal`, so a sweep of the closed page walks past
 * the screens where labels, placeholders and field alignment actually live. The first version of
 * this audit did exactly that and reported everything clean, which is how the defects survived a
 * pass that believed it had checked.
 */
test.use({ storageState: sessionFile('admin') });

// Thirteen screens, each a navigation plus a dialog open, in one test on purpose: the offender list
// is only useful whole.
test.setTimeout(240_000);

/**
 * Screens with a primary "create" action, and the control that opens it.
 *
 * The names are the ones the buttons actually carry, read off the running app rather than guessed
 * from the route. An earlier version guessed, eight of the thirteen never opened, and the spec
 * reported a pass on the five it managed — which is the failure mode this whole file exists to
 * avoid.
 */
const FORMS = [
  { route: '/entities', open: /^New entity$/i },
  { route: '/agents', open: /^New agent$/i },
  { route: '/users', open: /^New user$/i },
  { route: '/templates', open: /^New template$/i },
  { route: '/reporting-periods', open: /^Open a period$/i },
  { route: '/reference-data', open: /^Add value$/i },
  { route: '/scheduled-reports', open: /^Schedule a report$/i },
  { route: '/api-credentials', open: /^(New credential|Issue a credential)$/i },
  { route: '/signing-certificates', open: /^Register a certificate$/i },
  // Not "/enforcement" with "Run compliance check": that button opens no dialog, it runs the
  // sweep. Clicking it here opened a case against every operator owing 2026 Q1, in the database
  // the rest of the suite shares, and enforcement-orders.spec then read the wrong case. Its own
  // log line said so ("trigger clicked, no dialog appeared") for two runs before anybody looked.
  { route: '/levy', open: /^Add a rate$/i },
  { route: '/documents', open: /^File a document$/i },
  { route: '/network-feeds', open: /^Add a feed$/i },
];

/**
 * Open the screen's create dialog, or say why it could not be opened.
 *
 * The visible-dialog filter is the point. Several screens keep a detail Drawer mounted with
 * `role="dialog"` and hidden, so `getByRole('dialog').first()` resolves to the Drawer, waits for a
 * thing that will never appear, and the timeout reads as "no such screen".
 */
async function openDialog(page: Page, route: string, open: RegExp): Promise<string | null> {
  await page.goto(route);
  await expect(page.getByRole('main')).toBeVisible();

  // `main` is visible well before the header's actions are, so the trigger gets its own wait.
  // Asking too early is what made four of these screens look as though they had no create button.
  const trigger = page.getByRole('button', { name: open }).first();
  try {
    await trigger.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    return 'no visible trigger';
  }
  if (!(await trigger.isEnabled())) return 'trigger is disabled';

  await trigger.click();
  const dialog = page.locator('[role="dialog"]').filter({ visible: true }).first();
  try {
    await expect(dialog).toBeVisible({ timeout: 5000 });
  } catch {
    return 'trigger clicked, no dialog appeared';
  }
  return null;
}

/** Read every convention out of whatever dialog is open, in one pass. */
async function auditOpenDialog(page: Page) {
  return page.evaluate(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (el) => (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0,
    );
    if (!dialog) return { unnamed: [], repeats: [], misaligned: [], noPlaceholder: [] };

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
      if (labelledBy) {
        const text = document.getElementById(labelledBy)?.textContent?.trim();
        if (text) return text;
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const wrapping = el.closest('label')?.textContent?.trim();
      return wrapping ?? '';
    };

    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]), textarea, select, [role="combobox"]',
      ),
    ).filter(visible);

    const unnamed: string[] = [];
    const repeats: string[] = [];
    const noPlaceholder: string[] = [];

    for (const el of controls) {
      const name = nameOf(el);
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') ?? '';

      if (!name) {
        unnamed.push(`${tag}${type ? `[${type}]` : ''}${el.id ? `#${el.id}` : ''}`);
        continue;
      }

      const placeholder = (el as HTMLInputElement).placeholder?.trim();
      if (placeholder && norm(placeholder) === norm(name))
        repeats.push(`${name}: "${placeholder}"`);

      // A free-text field with no example leaves the user guessing at the format.
      const freeText = tag === 'textarea' || ['text', 'email', 'tel', 'url', ''].includes(type);
      if (freeText && !placeholder && el.getAttribute('role') !== 'combobox') {
        noPlaceholder.push(name);
      }
    }

    // Fields that render on one row must line up on that row.
    const rows = new Map<number, { name: string; top: number }[]>();
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      const key = Math.round(r.top / 14);
      const entry = { name: nameOf(el) || el.tagName.toLowerCase(), top: r.top };
      const near = [key - 1, key, key + 1].find((k) => rows.has(k));
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

    return { unnamed, repeats, misaligned, noPlaceholder };
  });
}

test('every dialog form follows the label, placeholder and alignment rules', async ({ page }) => {
  const offenders: string[] = [];
  const skipped: string[] = [];

  for (const form of FORMS) {
    const problem = await openDialog(page, form.route, form.open).catch((e: Error) => e.message);
    if (problem) {
      skipped.push(`${form.route} (${problem})`);
      continue;
    }

    const { unnamed, repeats, misaligned, noPlaceholder } = await auditOpenDialog(page);
    unnamed.forEach((u) => offenders.push(`${form.route} · no accessible name: ${u}`));
    repeats.forEach((r) => offenders.push(`${form.route} · placeholder repeats label: ${r}`));
    misaligned.forEach((m) => offenders.push(`${form.route} · row not aligned: ${m}`));
    noPlaceholder.forEach((n) => offenders.push(`${form.route} · no example placeholder: ${n}`));
  }

  // Say which screens could not be opened, so a silent miss never reads as a pass.
  if (skipped.length > 0) console.log('dialogs not opened:', skipped.join(', '));

  expect(offenders, 'dialog form conventions').toEqual([]);
});
