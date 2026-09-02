import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

interface RequestWithUser extends Request {
  user?: { id?: string };
}

/**
 * Logs one line per request — method, path, status, duration, correlation id, and the acting
 * user when authenticated. The line is emitted on both success and failure (via tap's error
 * callback), so 4xx/5xx responses are just as visible in the logs as 2xx ones.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const { method, url } = req;
    const rid = req.headers['x-request-id'];
    const requestId = Array.isArray(rid) ? rid[0] : rid;
    const start = Date.now();

    const write = (status: number | string) => {
      const ms = Date.now() - start;
      const who = req.user?.id ? ` user=${req.user.id}` : '';
      this.logger.log(`[${requestId}] ${method} ${url} ${status} - ${ms}ms${who}`);
    };

    return next.handle().pipe(
      tap({
        next: () => write(context.switchToHttp().getResponse().statusCode),
        // On a thrown error the response status isn't set yet, so read it from the error.
        error: (err: { status?: number }) => write(err?.status ?? 500),
      }),
    );
  }
}
