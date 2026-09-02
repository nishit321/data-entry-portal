import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * The accessibility scan, shared by every browser spec that needs one.
 *
 * Lives outside the spec files because Playwright will not let one spec import another — and it is
 * needed in two: the page sweep in `a11y.spec.ts`, and the return editor in `journey.spec.ts`,
 * which is the one screen that has to be scanned with real answers in it.
 */
/** Everything axe knows, minus nothing. If a rule fires here it is about the shipped page. */
export async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
}

export function report(violations: Awaited<ReturnType<typeof scan>>['violations']) {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.html.slice(0, 200)}`).join('\n'),
    )
    .join('\n\n');
}
