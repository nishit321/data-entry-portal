import { expect, type Page } from '@playwright/test';

/**
 * The UI conventions, defined once.
 *
 * They were written out four times: once for the page sweep, once for the dialogs, once for the
 * non-administrator roles, once for the editors. Four copies of a rule is four rules, and they
 * drift the first time one of them is corrected. This is the definition; the specs decide *where*
 * to apply it.
 */
export type ConventionFindings = {
  /** Controls a screen reader would announce as nothing. */
  unnamed: string[];
  /** Placeholders that say the label again and so teach nothing. */
  repeats: string[];
  /** Controls that render on one row without lining up on it. */
  misaligned: string[];
  /** Free-text fields with no example to show the expected shape. */
  noPlaceholder: string[];
  /**
   * How many controls were actually measured.
   *
   * An audit that found nothing to look at returns four empty lists, which is indistinguishable
   * from a clean screen. Specs assert on this so that a navigation which quietly failed cannot
   * read as a pass.
   */
  measured: number;
};

/**
 * `page` measures the whole screen. `visible-dialog` measures inside whichever dialog is open,
 * which matters because several screens keep a detail Drawer mounted and hidden: taking the first
 * `[role="dialog"]` in the document finds that one and measures nothing.
 */
export type Scope = 'page' | 'visible-dialog';

export async function auditConventions(
  page: Page,
  scope: Scope = 'page',
): Promise<ConventionFindings> {
  return page.evaluate((mode) => {
    const isVisible = (el: Element) =>
      (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0;

    const root: ParentNode | null =
      mode === 'page'
        ? document.body
        : (Array.from(document.querySelectorAll('[role="dialog"]')).find(isVisible) ?? null);

    const empty: ConventionFindings = {
      unnamed: [],
      repeats: [],
      misaligned: [],
      noPlaceholder: [],
      measured: 0,
    };
    if (!root) return empty;

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
      return el.closest('label')?.textContent?.trim() ?? '';
    };

    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]), textarea, select, [role="combobox"]',
      ),
    ).filter(isVisible);

    const findings: ConventionFindings = {
      unnamed: [],
      repeats: [],
      misaligned: [],
      noPlaceholder: [],
      measured: controls.length,
    };

    for (const el of controls) {
      const name = nameOf(el);
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') ?? '';

      if (!name) {
        findings.unnamed.push(`${tag}${type ? `[${type}]` : ''}${el.id ? `#${el.id}` : ''}`);
        continue;
      }

      const placeholder = (el as HTMLInputElement).placeholder?.trim();
      if (placeholder && norm(placeholder) === norm(name)) {
        findings.repeats.push(`${name}: "${placeholder}"`);
      }

      const freeText = tag === 'textarea' || ['text', 'email', 'tel', 'url', ''].includes(type);
      if (freeText && !placeholder && el.getAttribute('role') !== 'combobox') {
        findings.noPlaceholder.push(name);
      }
    }

    // Group by the row a control renders on, then check each group agrees on its top edge.
    // Checkboxes and radios are left out: they are a different height by nature and sit beside
    // text rather than beside other fields.
    const rows = new Map<number, { name: string; top: number }[]>();
    for (const el of controls) {
      const type = el.getAttribute('type');
      if (type === 'checkbox' || type === 'radio') continue;
      const box = el.getBoundingClientRect();
      if (box.height === 0) continue;

      const key = Math.round(box.top / 12);
      const entry = { name: nameOf(el) || el.tagName.toLowerCase(), top: box.top };
      const near = [key - 1, key, key + 1].find((k) => rows.has(k));
      if (near !== undefined) rows.get(near)!.push(entry);
      else rows.set(key, [entry]);
    }

    for (const group of rows.values()) {
      if (group.length < 2) continue;
      const tops = group.map((g) => g.top);
      const drift = Math.max(...tops) - Math.min(...tops);
      if (drift > 1) {
        findings.misaligned.push(
          `${group.map((g) => g.name).join(' | ')} differ by ${drift.toFixed(1)}px`,
        );
      }
    }

    return findings;
  }, scope);
}

/**
 * Flatten findings into one labelled list, the form every spec reports in.
 *
 * `skip` exists for screens a rule genuinely does not govern, and the caller has to name the rule
 * it is skipping, in the open, with a reason beside it. The alternative is a spec that quietly
 * stops checking something.
 */
export function describeFindings(
  where: string,
  f: ConventionFindings,
  skip: (keyof Omit<ConventionFindings, 'measured'>)[] = [],
): string[] {
  const all = {
    unnamed: f.unnamed.map((u) => `${where}: no accessible name: ${u}`),
    repeats: f.repeats.map((r) => `${where}: placeholder repeats label: ${r}`),
    misaligned: f.misaligned.map((m) => `${where}: row not aligned: ${m}`),
    noPlaceholder: f.noPlaceholder.map((n) => `${where}: no example placeholder: ${n}`),
  };
  return (Object.keys(all) as (keyof typeof all)[])
    .filter((rule) => !skip.includes(rule))
    .flatMap((rule) => all[rule]);
}

/**
 * Wait for the authenticated shell, then for the screen's first data load.
 *
 * The generous timeout is deliberate. `ProtectedRoute` renders a bare spinner in place of the
 * whole shell while it confirms who is signed in, so there is genuinely no `main` for a moment
 * after a cold navigation, and longer when the machine is busy. The default five seconds turned
 * that into a failure that read as "the page is broken".
 */
export async function settle(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}
