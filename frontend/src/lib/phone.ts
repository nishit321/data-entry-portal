/**
 * Reading a stored number back on screen.
 *
 * The server stores E.164 (`+211920000000`) because that is the only shape that can be dialled
 * from anywhere. That is not how anyone reads a number, so it is grouped here before it is shown.
 * Mirrors `backend/src/common/utils/phone.util.ts`; the server remains the authority on what is a
 * valid number.
 */
const DEFAULT_COUNTRY_CODE = '211';

export function formatPhone(e164: string): string {
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return e164;
  const digits = e164.slice(1);
  const code = digits.startsWith(DEFAULT_COUNTRY_CODE)
    ? DEFAULT_COUNTRY_CODE
    : digits.slice(0, digits.length > 11 ? 3 : 2);
  const rest = digits.slice(code.length);
  return `+${code} ${(rest.match(/.{1,3}/g) ?? [rest]).join(' ')}`;
}
