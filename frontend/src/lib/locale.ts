/**
 * The one place the product's language and writing direction are decided.
 *
 * Q9 settled the requirement: English for the first release, built so Arabic can be added without
 * a rewrite. That second half is the reason this file exists while there is only one locale in it.
 * Adding a language should be a line here plus a set of strings — not a hunt through a hundred
 * components for the places that assumed English, or assumed left-to-right.
 *
 * What this file deliberately does **not** do is decide that Arabic is coming. It is not on the
 * list below, and putting it there would be inventing a requirement nobody has asked for. The
 * point is that the decision, when it is taken, lands in one place.
 */

export type Direction = 'ltr' | 'rtl';

export interface Locale {
  /** BCP 47, as `lang` wants it. */
  readonly code: string;
  /** What the language is called in itself, for a picker that does not exist yet. */
  readonly name: string;
  readonly direction: Direction;
}

export const LOCALES: Record<string, Locale> = {
  en: { code: 'en', name: 'English', direction: 'ltr' },
};

export const DEFAULT_LOCALE = LOCALES.en!;

/**
 * Tell the document what it is.
 *
 * `lang` is not decoration: a screen reader picks its pronunciation from it, and reads English
 * with Arabic phonetics — or the reverse — when it is wrong or missing. `dir` decides which way
 * every logical margin, padding and text alignment resolves, which is why the layout uses those
 * rather than `left` and `right` (`rtl-readiness.test.ts` keeps it that way).
 *
 * Called once at start-up. It is idempotent, so calling it again with a different locale is how a
 * language switch would work when there is one.
 */
export function applyLocale(locale: Locale = DEFAULT_LOCALE): void {
  const root = document.documentElement;
  root.lang = locale.code;
  root.dir = locale.direction;
}
