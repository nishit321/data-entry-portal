/**
 * Phone numbers, stored one way and one way only.
 *
 * A number is worth having only if it can be dialled from anywhere, so everything is kept in E.164
 * — a leading `+`, then country code and subscriber number, no spaces or punctuation. Operators
 * will type it however they are used to writing it down: `0920 000 000`, `+211 920 000 000`,
 * `211-920-000-000`. All three are the same number and all three must land in the database
 * identically, or the same person ends up with three records and two of them never receive
 * anything.
 *
 * The gateway wants it without the `+` (see `sms/x-technologies.provider.ts`). That is the
 * gateway's business, and the conversion happens there rather than here: storing a number in
 * whatever shape today's vendor prefers is how a database ends up describing a contract instead of
 * a fact.
 */

/** South Sudan. Used when somebody writes a local number with no country code. */
export const DEFAULT_COUNTRY_CODE = '211';

/** E.164 allows fifteen digits after the `+`, and a country code never starts with zero. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Everything a person might use to make a number readable, and none of it meaningful.
 *
 * The range `‐-―` is U+2010 to U+2015: the hyphen, the non-breaking hyphen, the figure dash, and
 * both kinds of long dash. A number pasted out of an email or a spreadsheet is full of them, and
 * on screen they are indistinguishable from an ordinary `-`. `\s` already covers the non-breaking
 * space, which arrives by the same route.
 */
const PUNCTUATION = /[\s‐-―\-().]/g;

/**
 * The number as it should be stored, or `null` if it cannot be read as one.
 *
 * `null` rather than a guess. A number that has been guessed at is worse than no number: nothing
 * says it is wrong, the reminder is sent, the delivery is recorded, and the operator never hears
 * from the Authority again.
 */
export function normalisePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const cleaned = input.replace(PUNCTUATION, '');
  if (!cleaned) return null;

  // Anything but digits, with one optional leading `+`, is not a phone number.
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let candidate: string;

  if (cleaned.startsWith('+')) {
    candidate = cleaned;
  } else if (cleaned.startsWith('00')) {
    // The old international prefix, still how a lot of people write it down.
    candidate = `+${cleaned.slice(2)}`;
  } else if (cleaned.startsWith('0')) {
    // A national number: the trunk zero is a domestic dialling instruction, not part of the number.
    candidate = `+${countryCode}${cleaned.slice(1)}`;
  } else if (cleaned.startsWith(countryCode)) {
    candidate = `+${cleaned}`;
  } else {
    /*
     * Bare digits with no country code and no trunk zero. Assuming the local country here would be
     * a coin toss: `912345678` is a valid South Sudanese subscriber number and also the start of a
     * dozen other countries' numbers. Refused, with the fix being obvious to whoever typed it.
     */
    return null;
  }

  return E164.test(candidate) ? candidate : null;
}

/** True when the string is already stored-shape. */
export function isE164(value: string): boolean {
  return E164.test(value);
}

/**
 * `+211920000000` → `+211 920 000 000`, for reading back on screen.
 *
 * Grouping in threes after the country code. Not a national numbering plan — those differ by
 * country and getting them right matters far less than the number being legible enough to check
 * against the one on somebody's business card.
 */
export function formatPhone(e164: string): string {
  if (!E164.test(e164)) return e164;
  const digits = e164.slice(1);
  const code = digits.startsWith(DEFAULT_COUNTRY_CODE)
    ? DEFAULT_COUNTRY_CODE
    : digits.slice(0, digits.length > 11 ? 3 : 2);
  const rest = digits.slice(code.length);
  const groups = rest.match(/.{1,3}/g) ?? [rest];
  return `+${code} ${groups.join(' ')}`;
}

/**
 * The last few digits, for saying which number without printing it.
 *
 * Used in confirmations ("we sent a code to the number ending 0000") and in logs. A phone number
 * identifies a person; writing it whole into a log file spreads it somewhere with a different
 * retention policy and a different set of readers.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••••${digits.slice(-4)}`;
}
