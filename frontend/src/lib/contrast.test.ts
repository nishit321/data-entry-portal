import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import config from '../../tailwind.config.js';

/**
 * Colour contrast, computed from the design tokens (FRONTEND_STANDARDS §6, WCAG 2.1 AA).
 *
 * This cannot be checked with axe in these tests: jsdom has no cascade, so every colour resolves
 * to the browser default and any verdict would be about jsdom rather than about the product. What
 * can be checked — and is the thing that actually governs the product — is the palette itself. The
 * pairs below are the ones the components really use, read out of the class names in `src`.
 *
 * AA asks 4.5:1 for body text and 3:1 for large text and for the boundaries of a control. All of
 * this product's text is 12–16px, so 4.5:1 is the bar throughout; nothing here is "large".
 *
 * When a new pairing appears in a component, add it here. A palette that is only checked where
 * someone remembered to check it is not a checked palette.
 */

const TEXT_AA = 4.5;
const UI_AA = 3;

type Palette = Record<string, Record<string, string> | string>;
const themeColors = (config.theme?.extend?.colors ?? {}) as Palette;

/** `bg-danger-600` / `text-white` / `bg-brand` → the hex the browser would paint. */
function hex(token: string): string {
  const name = token.replace(/^(bg|text|border)-/, '');
  if (name === 'white') return '#ffffff';
  if (name === 'black') return '#000000';

  // Split at the last hyphen, so `brand-900` and `sidebar-dim` both resolve. It used to split
  // only before trailing digits, which meant a token named for its role could not be checked at
  // all — and a colour nothing can check is how the sidebar's 3.04:1 survived §3.5.
  const [family, shade] = name.split(/-(?=[^-]+$)/);
  const own = themeColors[family as string];
  if (own) {
    if (typeof own === 'string') return own;
    const value = own[shade ?? 'DEFAULT'];
    if (value) return value;
  }

  // Families the config does not override (gray) come from Tailwind's own palette.
  const stock = (colors as unknown as Palette)[family as string];
  if (stock && typeof stock !== 'string') {
    const value = stock[shade ?? '500'];
    if (value) return value;
  }
  throw new Error(`No colour for "${token}"`);
}

/** WCAG relative luminance. */
function luminance(h: string): number {
  const rgb = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(hex(a)), luminance(hex(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text colour on a background, as the components pair them. */
const TEXT_ON_TINT: [string, string][] = [
  ['text-white', 'bg-brand'],
  ['text-white', 'bg-brand-600'],
  ['text-white', 'bg-danger-600'],
  ['text-brand-700', 'bg-brand-50'],
  ['text-brand-800', 'bg-brand-50'],
  ['text-success-700', 'bg-success-50'],
  ['text-success-700', 'bg-success-100'],
  ['text-warning-700', 'bg-warning-50'],
  ['text-warning-700', 'bg-warning-100'],
  ['text-danger-700', 'bg-danger-50'],
  ['text-danger-700', 'bg-danger-100'],
  ['text-info-700', 'bg-info-50'],
  ['text-info-700', 'bg-info-100'],
  ['text-gray-600', 'bg-gray-100'],
  ['text-gray-700', 'bg-gray-100'],
  ['text-gray-800', 'bg-gray-100'],
  ['text-gray-900', 'bg-gray-100'],
];

/** Text on the two page grounds: cards and inputs are white, the page behind them is gray-50. */
const TEXT_ON_PAGE: [string, string][] = [
  ['text-gray-500', 'bg-white'],
  ['text-gray-500', 'bg-gray-50'],
  ['text-gray-600', 'bg-white'],
  ['text-gray-700', 'bg-white'],
  ['text-gray-800', 'bg-white'],
  ['text-gray-900', 'bg-white'],
  ['text-danger-600', 'bg-white'],
  ['text-brand', 'bg-white'],
  ['text-brand-800', 'bg-white'],
];

/**
 * The sidebar, which sits on navy rather than on either page ground.
 *
 * It was missing from the tables above, and that is exactly why its section headings shipped at
 * 3.04:1: a pair nothing measures is a pair nobody notices. `sidebar-fg` and `sidebar-muted` carry
 * real text; `sidebar-dim` is the quiet furniture and is held to the same bar because a heading
 * somebody cannot read is not furniture.
 */
const TEXT_ON_SIDEBAR: [string, string][] = [
  ['text-sidebar-fg', 'bg-brand-900'],
  ['text-sidebar-muted', 'bg-brand-900'],
  ['text-sidebar-dim', 'bg-brand-900'],
];

describe('colour contrast', () => {
  it.each(TEXT_ON_SIDEBAR)('%s on %s', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it.each(TEXT_ON_TINT)('%s on %s', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it.each(TEXT_ON_PAGE)('%s on %s', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it('holds icons against their tint at the control bar', () => {
    // `text-danger-600` on `bg-danger-50` is 4.4:1 — under the bar for text, comfortably over it
    // for a graphic. It is used for icons only: the error boundary's warning circle, and the hover
    // state of a destructive icon button. The destructive item in a menu is text, so that one
    // reads `text-danger-700`.
    expect(contrast('text-danger-600', 'bg-danger-50')).toBeGreaterThanOrEqual(UI_AA);
    expect(contrast('text-danger-600', 'bg-danger-50')).toBeLessThan(TEXT_AA);
  });

  it('keeps the focus ring visible against both grounds', () => {
    // The ring is how a keyboard user knows where they are. It is a control boundary, so 3:1.
    expect(contrast('text-brand', 'bg-white')).toBeGreaterThanOrEqual(UI_AA);
    expect(contrast('text-brand', 'bg-gray-50')).toBeGreaterThanOrEqual(UI_AA);
  });

  it('keeps a disabled control legible', () => {
    // Disabled text is exempt from AA. It is checked anyway at the lower bar, because an operator
    // still has to read the value of a field they are not allowed to change.
    expect(contrast('text-gray-500', 'bg-gray-50')).toBeGreaterThanOrEqual(UI_AA);
  });
});

/*
 * The component sources, read back as text, the same way `strings.test.ts` reads them.
 */
const SOURCES = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * A grey too light to read, caught in the source rather than in a browser.
 *
 * `text-gray-400` is about 2.5:1 on white and 2.4:1 on gray-50, under half of what AA asks for
 * text, and this product has never allowed it for words. It slipped into a dashboard card anyway
 * ("No comparison") and was only found when the browser suite's axe pass reached the dashboard,
 * forty minutes into a run. jsdom cannot see colour, so none of the unit tests could.
 *
 * Icons may still use it: a decorative icon is `aria-hidden`, carries no words, and is not held to
 * the text bar. So the rule is narrow, and it is the one that was broken: an element whose class
 * list has `text-gray-400` must be marked `aria-hidden`.
 */
describe('text colours too light to read', () => {
  const files = Object.entries(SOURCES).filter(([path]) => !path.endsWith('.test.tsx'));

  it('is reading the real component tree', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('never puts gray-400 on anything a person has to read', () => {
    const offenders: string[] = [];
    for (const [path, source] of files) {
      // Each opening tag, attributes and all, so a multi-line element is judged as one.
      for (const tag of source.matchAll(/<[A-Za-z][\w.]*\b[^<>]*?className=[^<>]*?>/gs)) {
        const text = tag[0];
        if (!/\btext-gray-400\b/.test(text)) continue;
        if (/aria-hidden/.test(text)) continue;
        const line = source.slice(0, tag.index).split('\n').length;
        offenders.push(`${path.replace(/^\.\.\//, '')}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
