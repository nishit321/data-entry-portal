import * as crypto from 'crypto';
import { RESET_TOKEN_BYTES } from '../constants/app.constants';

/** Generate a cryptographically-random, URL-safe token (raw, unhashed). */
export function generateRawToken(): string {
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
}

/**
 * Deterministically hash a token with SHA-256 for storage/lookup.
 * We store only the hash so a database leak cannot reveal usable tokens.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
