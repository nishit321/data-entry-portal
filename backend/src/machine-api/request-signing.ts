import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Signing and verifying machine-to-machine requests (Q10, Phase 3).
 *
 * Q10 requires signed payloads. The scheme below is the ordinary one — the same shape AWS and
 * Stripe use — chosen because an operator's integrator will already have written it once:
 *
 *   signature = HMAC-SHA256(secret, timestamp + "." + nonce + "." + METHOD + "." + path + "." + sha256(body))
 *
 * Each part is there for a reason, and leaving any of them out breaks a property:
 *
 * - **The body hash** is what makes it a signature over the payload rather than over a promise. It
 *   is the hash and not the body itself so the string being signed stays a fixed size.
 * - **The method and path** stop a signed body being replayed against a different endpoint —
 *   without them, a signed "save these values" could be posted at "submit this return".
 * - **The timestamp** bounds how long a captured request stays useful.
 * - **The nonce** makes it useful exactly once inside that window. The timestamp alone is not
 *   enough: five minutes is a long time to hold a captured request.
 *
 * Nothing here touches the database or the clock beyond what it is handed, so the whole scheme can
 * be reasoned about — and shown to an integrator — on its own.
 */

/** How far a request's timestamp may be from ours, in either direction. */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export const SIGNATURE_HEADERS = {
  timestamp: 'x-nca-timestamp',
  nonce: 'x-nca-nonce',
  signature: 'x-nca-signature',
} as const;

export interface SignatureInput {
  /** ISO-8601, as the client sent it. */
  timestamp: string;
  /** Single-use value chosen by the client. */
  nonce: string;
  method: string;
  /** Path including the API prefix and version, without the query string. */
  path: string;
  /** The raw request body exactly as sent. An empty body hashes as an empty string. */
  body: string;
}

/** The exact string a signature is taken over. Exported so integrators can be shown it. */
export function signingString(input: SignatureInput): string {
  const bodyHash = createHash('sha256')
    .update(input.body ?? '', 'utf8')
    .digest('hex');
  return [input.timestamp, input.nonce, input.method.toUpperCase(), input.path, bodyHash].join('.');
}

export function sign(secret: string, input: SignatureInput): string {
  return createHmac('sha256', secret).update(signingString(input), 'utf8').digest('hex');
}

/**
 * Compare two signatures without leaking, through timing, how much of one matched.
 *
 * A plain `===` on a secret-derived value tells an attacker how many leading characters were right,
 * one request at a time. Both sides are hashed first so the comparison is over equal-length buffers
 * whatever the caller sent — `timingSafeEqual` throws on a length mismatch, and that throw would
 * itself be an oracle for the signature's length.
 */
export function signaturesMatch(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256')
    .update(provided ?? '', 'utf8')
    .digest();
  return timingSafeEqual(a, b);
}

export type SignatureFailure = 'MISSING' | 'BAD_TIMESTAMP' | 'STALE' | 'FUTURE' | 'BAD_SIGNATURE';

export interface VerifyResult {
  ok: boolean;
  reason?: SignatureFailure;
  /** How long the nonce must be remembered for, so a replay inside the window is caught. */
  nonceExpiresAt?: Date;
}

/**
 * Check a signature against the secret, at a given moment.
 *
 * `now` is a parameter rather than read from the clock so the window can be tested at its edges,
 * which is the only place the rule is interesting.
 */
export function verifySignature(
  secret: string,
  input: Partial<SignatureInput> & { signature?: string },
  now: Date,
): VerifyResult {
  const { timestamp, nonce, method, path, signature } = input;
  if (!timestamp || !nonce || !signature || !method || path === undefined) {
    return { ok: false, reason: 'MISSING' };
  }

  const sent = new Date(timestamp);
  if (Number.isNaN(sent.getTime())) return { ok: false, reason: 'BAD_TIMESTAMP' };

  const drift = now.getTime() - sent.getTime();
  // A request from the future is refused as firmly as a stale one: it is either a badly set clock
  // or an attempt to mint a signature that stays valid for longer than the window allows.
  if (drift > SIGNATURE_WINDOW_MS) return { ok: false, reason: 'STALE' };
  if (drift < -SIGNATURE_WINDOW_MS) return { ok: false, reason: 'FUTURE' };

  const expected = sign(secret, { timestamp, nonce, method, path, body: input.body ?? '' });
  if (!signaturesMatch(expected, signature)) return { ok: false, reason: 'BAD_SIGNATURE' };

  return { ok: true, nonceExpiresAt: new Date(sent.getTime() + SIGNATURE_WINDOW_MS) };
}

/** What the client should be told, without saying which check failed in a way that helps an attacker. */
export const SIGNATURE_MESSAGES: Record<SignatureFailure, string> = {
  MISSING: 'This request is not signed. Include a timestamp, a nonce and a signature.',
  BAD_TIMESTAMP: 'The request timestamp is not a valid date.',
  STALE: 'This request is too old. Check the clock on the sending system and try again.',
  FUTURE: 'This request is dated in the future. Check the clock on the sending system.',
  BAD_SIGNATURE: 'The signature does not match the request.',
};
