// Shared display formatters. Every screen renders dates, numbers, and money through
// these so the same value looks identical everywhere (FRONTEND_STANDARDS §2/§3.6,
// CODING_STANDARDS §5). No inline `.slice()` / `toLocaleString` at call sites.

const LOCALE = 'en-GB';

/** ISO date/datetime → `dd Mon yyyy` (e.g. 23 Jul 2026). Blank input renders as an em dash. */
export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** ISO datetime → `dd Mon yyyy, hh:mm AM/PM` (12-hour clock, e.g. 23 Jul 2026, 02:30 PM). */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * ISO datetime → "2 hours ago". Recency is what a reader of an audit trail or a review queue is
 * actually judging — "how long has this been sitting there" — and an absolute timestamp makes
 * them do the arithmetic. The exact time is never dropped: the `RelativeTime` component keeps it
 * in a tooltip and in the `<time>` element (FRONTEND_STANDARDS §3.4).
 */
export function formatRelativeTime(value?: string | Date | null, now: Date = new Date()): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = date.getTime() - now.getTime();
  const absolute = Math.abs(diff);
  if (absolute < 45_000) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (absolute >= ms) return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(Math.round(diff / 1000), 'second');
}

/**
 * Join the parts of a one-line description with the product's separator.
 *
 * There is one separator in this product and it lives here. It had been typed inline at eighteen
 * call sites, in two different glyphs, which is how a picker ends up reading differently from the
 * row it populates. Empty parts are dropped, so an optional value simply doesn't appear rather
 * than leaving a stranded separator behind it.
 *
 *   joinMeta('Nile ISP', null, 'due 06 Sep 2026')  ->  'Nile ISP · due 06 Sep 2026'
 */
export function joinMeta(...parts: (string | number | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string | number => p !== null && p !== undefined && p !== false && p !== '')
    .join(' · ');
}

/**
 * A stored field name to the words a person would use. `registeredAccounts` becomes
 * "Registered accounts"; `licence_number` becomes "Licence number".
 *
 * Field keys are how the database names things, not how the Authority names them. Printing them
 * raw is the jargon leak CODING_STANDARDS §8 and FRONTEND_STANDARDS §10 both forbid — it just
 * happened to leak through the audit trail's metadata rather than through a form label.
 */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const BROWSERS: [RegExp, string][] = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/chrome|crios/i, 'Chrome'],
  [/firefox|fxios/i, 'Firefox'],
  [/safari/i, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/windows/i, 'Windows'],
  [/android/i, 'Android'],
  [/iphone|ipad|ios/i, 'iOS'],
  [/mac os|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
];

/**
 * A user-agent string → "Chrome on Windows".
 *
 * The raw header is developer output: eight fragments of version numbers and rendering-engine
 * history that tell a reader nothing about who was at the keyboard. What an audit reader actually
 * wants from it is "was this the usual browser on the usual machine", and that is two words.
 */
export function describeDevice(userAgent?: string | null): string | null {
  if (!userAgent) return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(userAgent))?.[1];
  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? 'Unknown device';
}

/** ISO date → `yyyy-mm-dd`, the value shape date inputs expect. */
export function toDateInputValue(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** Thousands-separated integer/decimal. */
export function formatNumber(value?: number | string | null, fractionDigits = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

/**
 * Money. Amounts are held in minor units (cents) per CODING_STANDARDS §5; pass the
 * minor-unit integer and it renders with two decimals. Default currency is USD.
 */
export function formatMoney(minorUnits?: number | null, currency = 'USD'): string {
  if (minorUnits === null || minorUnits === undefined) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
  }).format(minorUnits / 100);
}

/**
 * An SSP amount that is already a major-unit decimal (what operators report on a return, and what
 * the levy engine returns) — unlike `formatMoney`, which takes minor units.
 */
export function formatSsp(amount?: number | null): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return `SSP ${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

/** A human file size, e.g. 24 KB or 1.4 MB. */
export function formatFileSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
