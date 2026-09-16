import { randomBytes } from 'crypto';
import { constantTimeEquals, keyFrom, open, seal, SecretBoxError } from './secret-box.util';

const KEY = randomBytes(32).toString('hex');

describe('keyFrom', () => {
  /*
   * Hex or base64, because `openssl rand -hex 32` and `openssl rand -base64 32` are both ordinary
   * habits and refusing one of them teaches nothing except that the field is fussy. What is not
   * negotiable is that the key is exactly 32 bytes.
   */
  it.each([
    ['hex, as `openssl rand -hex 32` gives it', randomBytes(32).toString('hex')],
    ['base64, as `openssl rand -base64 32` gives it', randomBytes(32).toString('base64')],
    ['base64url, which some tools produce', randomBytes(32).toString('base64url')],
    ['a key with stray whitespace around it', `  ${randomBytes(32).toString('hex')}  `],
  ])('accepts %s', (_name, good) => {
    expect(keyFrom(good)).toHaveLength(32);
  });

  it.each([
    ['', 'nothing configured'],
    ['   ', 'only whitespace'],
    ['tooshort', 'too short'],
    ['not a key at all', 'not an encoding at all'],
    [randomBytes(16).toString('hex'), 'hex, but only 16 bytes'],
    [randomBytes(24).toString('base64'), 'base64, but only 24 bytes'],
  ])('refuses %s (%s)', (bad) => {
    // Refused rather than padded, hashed or otherwise made to work. A key that has been quietly
    // salvaged gives real reassurance and no real protection.
    expect(() => keyFrom(bad)).toThrow(SecretBoxError);
  });

  it('refuses a base64 key that lost a character on its way here', () => {
    // The real case this was written for. `Buffer.from(x, 'base64')` ignores what it does not
    // recognise, so a truncated key decodes happily to the wrong length and looks fine.
    const full = randomBytes(32).toString('base64');
    const short = full.replace(/=+$/, '').slice(0, -1);

    expect(() => keyFrom(short)).toThrow(/exactly 32 bytes/);
  });

  it('says how many bytes it got, not merely that it is unhappy', () => {
    // Somebody reading this at deploy time needs to know what to fix.
    expect(() => keyFrom(randomBytes(24).toString('base64'))).toThrow(/gives 24/);
    expect(() => keyFrom(randomBytes(16).toString('hex'))).toThrow(/this one is 32/);
  });
});

describe('seal and open', () => {
  const key = keyFrom(KEY);

  it('gives back exactly what went in', () => {
    expect(open(seal('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never produces the same ciphertext twice for the same secret', () => {
    // A fresh IV each time. Otherwise two users with the same secret are visibly the same in the
    // database, and so is one user before and after a re-enrolment.
    const a = seal('same-secret', key);
    const b = seal('same-secret', key);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe(open(b, key));
  });

  it('does not leave the secret readable in what it stores', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', key);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(Buffer.from(sealed, 'utf8').toString('base64')).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('refuses a value tampered with in transit or at rest', () => {
    // GCM authenticates as well as encrypts. Without that, an altered row would decrypt to
    // rubbish and the rubbish would then be compared against somebody's six digits.
    const sealed = seal('JBSWY3DPEHPK3PXP', key);
    const parts = sealed.split('.');
    const flipped = Buffer.from(parts[3]!, 'base64url');
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString('base64url');

    expect(() => open(parts.join('.'), key)).toThrow(SecretBoxError);
  });

  it('refuses a value written under a different key', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', key);
    expect(() => open(sealed, keyFrom(randomBytes(32).toString('hex')))).toThrow(SecretBoxError);
  });

  it.each([
    ['not-sealed-at-all', 'a plain string'],
    ['v2.a.b.c', 'a version this build does not write'],
    ['v1.only.three', 'a truncated value'],
  ])('refuses %s (%s)', (bad) => {
    expect(() => open(bad, key)).toThrow(SecretBoxError);
  });

  it('says the same thing whether the key is wrong or the value was altered', () => {
    // Distinguishing the two would tell somebody probing that they had found the right key.
    const sealed = seal('secret', key);
    const wrongKey = (() => {
      try {
        open(sealed, keyFrom(randomBytes(32).toString('hex')));
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    const tampered = (() => {
      const parts = sealed.split('.');
      const flipped = Buffer.from(parts[3]!, 'base64url');
      flipped[0] ^= 0xff;
      parts[3] = flipped.toString('base64url');
      try {
        open(parts.join('.'), key);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();

    expect(wrongKey).toBe(tampered);
    expect(wrongKey).toBeTruthy();
  });
});

describe('constantTimeEquals', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });

  it('handles different lengths without throwing', () => {
    expect(constantTimeEquals('short', 'much longer string')).toBe(false);
  });

  it('handles empty and missing values', () => {
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('a', '')).toBe(false);
  });
});
