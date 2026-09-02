import { render, type RenderResult } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

/**
 * Accessibility assertions for component tests (FRONTEND_STANDARDS §6).
 *
 * The standard says accessibility is part of Done rather than a later pass. This is what makes
 * that checkable instead of merely stated: axe runs over the rendered DOM, so a component that
 * loses its label or grows an invalid ARIA structure fails a test rather than reaching a user.
 *
 * Two rules are switched off here, and neither is a way of ducking them:
 *
 * - **`color-contrast`** cannot be judged in jsdom. There is no layout and no cascade, so every
 *   colour resolves to the browser default and any verdict would be about jsdom, not about the
 *   product. Contrast is checked instead in `contrast.test.ts`, which computes the real ratios
 *   from the design tokens themselves.
 * - **`region`** asks that all content sit inside a landmark. That is a question about a page, and
 *   these tests render a single component with nothing around it. It is checked in the page-level
 *   tests, where it means something.
 */
const COMPONENT_RULES = {
  'color-contrast': { enabled: false },
  region: { enabled: false },
};

export async function expectNoViolations(target: Element | Document = document.body) {
  const results = await axe(target as Element, { rules: COMPONENT_RULES });
  const violations = results.violations ?? [];
  if (violations.length > 0) {
    // The default matcher prints a wall of JSON. This prints the rule, the plain-English reason,
    // and the offending markup, which is what tells you what to change.
    const detail = violations
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help}\n` +
          v.nodes.map((n) => `    ${n.html}`).join('\n') +
          `\n    ${v.helpUrl}`,
      )
      .join('\n\n');
    throw new Error(`axe found ${violations.length} accessibility violation(s):\n\n${detail}`);
  }
  expect(violations).toHaveLength(0);
}

/** Render, then assert the result is clean. Overlays portal, so the whole body is checked. */
export async function renderAndCheck(ui: ReactElement): Promise<RenderResult> {
  const result = render(ui);
  await expectNoViolations(document.body);
  return result;
}
