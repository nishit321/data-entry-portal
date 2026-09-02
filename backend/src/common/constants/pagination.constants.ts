/**
 * Pagination defaults, shared by every list endpoint. One source of truth so
 * page sizing is consistent (and capped) across the whole API.
 */

/** Default number of rows per page when the client does not specify one. */
export const DEFAULT_PAGE_SIZE = 20;

/** Hard upper bound on page size. Requests above this are rejected, not clamped. */
export const MAX_PAGE_SIZE = 100;

/** Default page number (1-based). */
export const DEFAULT_PAGE = 1;
