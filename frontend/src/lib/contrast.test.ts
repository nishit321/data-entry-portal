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

  const [family, shade] = name.split(/-(?=\d+$)/);
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

describe('colour contrast', () => {
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
