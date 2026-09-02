import { Request } from 'express';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  /** Per-request correlation id (X-Request-Id), persisted on audit records. */
  requestId?: string;
}

/**
 * Extract client IP, user-agent, and the correlation id from an Express request
 * for audit logging. Respects X-Forwarded-For behind a proxy/load balancer.
 */
export function getRequestContext(req: Request): RequestContext {
  const forwarded = req.headers['x-forwarded-for'];
  const ipAddress =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    undefined;

  const userAgentHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;

  const ridHeader = req.headers['x-request-id'];
  const requestId = Array.isArray(ridHeader) ? ridHeader[0] : ridHeader;

  return { ipAddress, userAgent, requestId };
}
