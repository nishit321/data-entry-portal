/**
 * Centralised application constants. Avoids magic numbers/strings scattered
 * across the codebase.
 */

/** bcrypt cost factor. 10-12 is the accepted range for interactive logins. */
export const BCRYPT_SALT_ROUNDS = 12;

/** Byte length of the random password-reset token before hex encoding. */
export const RESET_TOKEN_BYTES = 32;

/** Byte length used when generating a temporary password for new users. */
export const TEMP_PASSWORD_BYTES = 9;

/** Global API route prefix. */
export const API_PREFIX = 'api';

/** Default API version (URI versioning). Routes are served under /api/v1. */
export const API_VERSION = '1';

/** Header carrying the per-request correlation id (lower-case for Express). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Metadata key used by the @Roles() decorator / RolesGuard. */
export const ROLES_KEY = 'roles';

/** Metadata key used by the @Public() decorator to bypass auth. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * The SMS gateway the Authority uses, unless the environment names another.
 *
 * Here rather than inline in the config so that `npm run preflight` judges the same value the
 * application would actually start with. A checker reading a different default from the thing it
 * checks is worse than no checker.
 */
export const DEFAULT_SMS_ENDPOINT = 'https://sms.xtechnologies.com.ss/api/http/sms/send';
