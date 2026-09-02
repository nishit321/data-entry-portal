import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { getRequestContext, RequestContext } from '../utils/request-context.util';

/** Injects { ipAddress, userAgent } for audit logging. */
export const ClientContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return getRequestContext(req);
  },
);
