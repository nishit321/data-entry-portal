import { expect, test } from '@playwright/test';
import { sessionFile } from './helpers';

/**
 * What the sidebar's text is actually painted, in a browser.
 *
 * The unit test beside `contrast.ts` reads the Tailwind config, which proves the palette is right
 * and nothing else. It cannot see a class that failed to reach the stylesheet, a rule losing to a
 * more specific one, or a colour inherited from somewhere unexpected — and any of those leaves a
 * navy panel with dark text on it while every check in the repo stays green.
 *
 * So this reads the computed colour off the running page and does the arithmetic on what the user
 * would see.
 */
test.use({ storageState: sessionFile('operator') });

/** WCAG relative luminance from a computed `rgb(...)` string. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number) as [
    number,
    number,
    number,
  ];
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('the sidebar reads against its own background', async ({ page }) => {
  await page.goto('/');

  const nav = page.getByRole('navigation').first();
  await expect(nav).toBeVisible();

  const background = await nav.evaluate((el) => {
    // The panel paints the ground; the nav itself may well be transparent.
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      const colour = getComputedStyle(node).backgroundColor;
      if (colour && colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  });

  // Every piece of text in the sidebar, not a sample: the heading that failed the last audit was
  // one nobody had thought to check.
  const colours = await nav.evaluate((el) =>
    [...el.querySelectorAll('a, button, p, div, span, h1, h2, h3')]
      .filter((n) => (n.textContent ?? '').trim().length > 0 && n.children.length === 0)
      .map((n) => ({
        text: (n.textContent ?? '').trim().slice(0, 40),
        colour: getComputedStyle(n).color,
      })),
  );

  expect(colours.length).toBeGreaterThan(5);
  const failures = colours
    .map((c) => ({ ...c, ratio: contrast(c.colour, background) }))
    .filter((c) => c.ratio < 4.5);

  expect(
    failures.map((f) => `"${f.text}" is ${f.colour} on ${background} — ${f.ratio.toFixed(2)}:1`),
  ).toEqual([]);
});
