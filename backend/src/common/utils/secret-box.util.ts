import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Encrypting a secret that has to be read back.
 *
 * A password is hashed, because nothing ever needs the original. A TOTP shared secret is different:
 * the server has to reproduce it on every sign-in to check the six digits. So it is encrypted, not
 * hashed, and the question becomes where the key lives.
 *
 * It lives outside the database. That is the whole point. A stolen database dump is the ordinary
 * disaster — a backup on a laptop, a misconfigured replica, a contractor with read access — and if
 * the second factor's secrets are sitting in it in plain text, every account's MFA is defeated
 * silently and nobody can tell it happened. With the key held separately, the dump is inert.
 *
 * AES-256-GCM: it authenticates as well as encrypts, so a tampered value fails loudly instead of
 * decrypting to rubbish that then gets compared against a code.
 */

/** Versioned, so the scheme can change later without guessing what an old row was written with. */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretBoxError extends Error {}

/**
 * Turn the configured key into bytes, or explain what is wrong with it.
 *
 * Hex or base64, whichever the operator's habit produced: `openssl rand -hex 32` and
 * `openssl rand -base64 32` are both ordinary ways to make a key, and refusing one of them teaches
 * nothing except that the field is fussy. What is *not* negotiable is the length — exactly 32
 * bytes — because that is the property the cipher depends on, and it is the one a truncated
 * copy-and-paste quietly breaks.
 *
 * Refuses rather than padding, hashing or otherwise salvaging a short value. A quietly-weakened key
 * is worse than no encryption, because the reassurance is real and the protection is not.
 */
export function keyFrom(value: string): Buffer {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new SecretBoxError('No encryption key is configured.');
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    if (trimmed.length !== KEY_BYTES * 2) {
      throw new SecretBoxError(
        `A hexadecimal key must be exactly ${KEY_BYTES * 2} characters (${KEY_BYTES} bytes); ` +
          `this one is ${trimmed.length}.`,
      );
    }
    return Buffer.from(trimmed, 'hex');
  }

  /*
   * Base64, verified by re-encoding rather than by trusting the decode.
   *
   * `Buffer.from(x, 'base64')` ignores anything it does not recognise, so a truncated or mistyped
   * key decodes happily to the wrong number of bytes and looks fine. Encoding the result back and
   * comparing is what catches the character that went missing on its way through a chat window.
   */
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new SecretBoxError(
      'The encryption key is not hexadecimal or base64. Generate one with ' +
        '`openssl rand -hex 32` or `openssl rand -base64 32`.',
    );
  }

  const decoded = Buffer.from(trimmed, 'base64');
  // Length first, because it names the likely cause. A truncated key fails both this and the
  // re-encoding check below, and "one character short" is far more use than "malformed".
  if (decoded.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `A base64 key must decode to exactly ${KEY_BYTES} bytes; this one gives ${decoded.length}. ` +
        'A character lost in copying is the usual cause. `openssl rand -base64 32` produces 44 ' +
        'characters ending in "=".',
    );
  }
  const canonical = decoded.toString('base64').replace(/=+$/, '');
  const asGiven = trimmed.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (canonical !== asGiven) {
    throw new SecretBoxError('The encryption key is not valid base64.');
  }
  return decoded;
}

/** `v1.iv.tag.ciphertext`, all base64url, safe to store in a text column. */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function open(sealed: string, key: Buffer): string {
  const parts = (sealed ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('That value was not written by this scheme.');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64!, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key, or the value was altered. Either way it cannot be trusted, and saying which it
    // was would tell an attacker whether they had found the right key.
    throw new SecretBoxError('That value could not be decrypted.');
  }
}

/**
 * Compare two secrets without leaking, through timing, how much of one matched.
 *
 * Used for recovery codes. The difference is measured in nanoseconds and matters anyway: a
 * comparison that returns early tells a patient attacker where the first wrong character was.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a ?? '', 'utf8');
  const right = Buffer.from(b ?? '', 'utf8');
  // Length is not secret here (these are fixed-width hashes), but the buffers must match for
  // timingSafeEqual to run at all.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
