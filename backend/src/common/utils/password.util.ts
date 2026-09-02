import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { BCRYPT_SALT_ROUNDS, TEMP_PASSWORD_BYTES } from '../constants/app.constants';

/** Hash a plaintext password using bcrypt. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_SALT_ROUNDS);
}

/** Constant-time comparison of a plaintext password against a bcrypt hash. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Generate a URL-safe temporary password that satisfies common complexity
 * rules (upper, lower, digit, symbol). Used when an admin creates a user
 * without specifying a password.
 */
export function generateTemporaryPassword(): string {
  const random = crypto.randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
  return `${random}A1!`;
}
