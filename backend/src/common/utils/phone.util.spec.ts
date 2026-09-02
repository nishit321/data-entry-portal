import { formatPhone, isE164, maskPhone, normalisePhone } from './phone.util';

/**
 * The same number, written six ways.
 *
 * This is the whole reason the module exists. An operator writing down a colleague's number does
 * not think about E.164; they write what they would dial. If two of those spellings store
 * differently, the portal quietly holds two contacts for one person and stops reaching one of them.
 */
describe('normalisePhone', () => {
  const SAME_NUMBER = [
    '+211920000000',
    '+211 920 000 000',
    '+211-920-000-000',
    '00211920000000',
    '211920000000',
    '0920000000',
    ' (0)920 000 000 ',
  ];

  it.each(SAME_NUMBER)('reads %s as the same South Sudanese number', (written) => {
    expect(normalisePhone(written)).toBe('+211920000000');
  });

  it('keeps a foreign number as written, rather than forcing it local', () => {
    // NCA staff and vendors are not all on +211, and a number rewritten to the wrong country is a
    // number that reaches somebody else.
    expect(normalisePhone('+256772123456')).toBe('+256772123456');
    expect(normalisePhone('00256772123456')).toBe('+256772123456');
  });

  it('honours a different default country when one is given', () => {
    expect(normalisePhone('0772123456', '256')).toBe('+256772123456');
  });

  it('refuses bare digits with no country code and no trunk zero', () => {
    // `912345678` is a valid South Sudanese subscriber number and also the opening of numbers in a
    // dozen other countries. Guessing here would be a coin toss dressed up as a feature.
    expect(normalisePhone('912345678')).toBeNull();
  });

  it.each([
    ['', 'nothing'],
    ['   ', 'only spaces'],
    ['not a number', 'letters'],
    ['+211 920 000 00x', 'a stray letter'],
    ['+0920000000', 'a country code starting with zero'],
    ['+21192', 'too few digits'],
    ['+2119200000000000000', 'more digits than E.164 allows'],
    ['++211920000000', 'two plus signs'],
  ])('refuses %s (%s)', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it('never returns something that is not storable', () => {
    // Whatever comes back is either null or dialable. Nothing in between reaches the database.
    for (const input of [...SAME_NUMBER, '+256772123456', 'rubbish', '912345678', '']) {
      const result = normalisePhone(input);
      expect(result === null || isE164(result)).toBe(true);
    }
  });
});

describe('formatPhone', () => {
  it('groups the digits so a number can be checked against a business card', () => {
    expect(formatPhone('+211920000000')).toBe('+211 920 000 000');
  });

  it('leaves anything that is not stored-shape exactly as it found it', () => {
    expect(formatPhone('0920000000')).toBe('0920000000');
  });
});

describe('maskPhone', () => {
  it('says which number without printing it', () => {
    expect(maskPhone('+211920001234')).toBe('••••1234');
  });

  it('gives nothing away when there is barely anything to mask', () => {
    expect(maskPhone('12')).toBe('••••');
  });
});
