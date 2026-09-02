import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
  requestId?: string;
}

/**
 * Converts every thrown error into a consistent JSON error envelope and logs
 * server-side faults. Known Prisma errors are mapped to sensible HTTP codes so
 * internal details never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "We couldn't complete that. Try again in a moment.";
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message = (body.message as string | string[]) ?? exception.message;
        error = (body.error as string) ?? exception.name;
      }
      error = error === 'InternalServerError' ? exception.name : error;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, error } = this.mapPrismaError(exception));
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Never surface internals to the user. Server faults (5xx) always get generic
    // wording — the real error is logged below with its stack. A rate-limit hit that
    // still carries the raw framework class name (e.g. "ThrottlerException") is
    // reworded too.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      message = "We couldn't complete that. Try again in a moment.";
    } else if (status === HttpStatus.TOO_MANY_REQUESTS && this.looksTechnical(message)) {
      message = 'Too many attempts. Please wait a moment and try again.';
    }

    const requestId = request.headers['x-request-id'];
    const requestIdStr = Array.isArray(requestId) ? requestId[0] : requestId;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${requestIdStr}] ${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: requestIdStr,
    };
    response.status(status).json(body);
  }

  private mapPrismaError(e: Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2002': // unique constraint
        return {
          status: HttpStatus.CONFLICT,
          message: 'Something with that value already exists. Choose a different one.',
          error: 'Conflict',
        };
      case 'P2025': // record not found
        return {
          status: HttpStatus.NOT_FOUND,
          message: "We couldn't find that. It may have been deleted.",
          error: 'NotFound',
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          message: "We couldn't complete that request. Please check your input and try again.",
          error: 'BadRequest',
        };
    }
  }

  /**
   * A message is "technical" if it exposes a framework/exception class name or
   * reads like an internal fault — the kind of thing an end user should never see.
   */
  private looksTechnical(message: string | string[]): boolean {
    const text = Array.isArray(message) ? message.join(' ') : message;
    return /exception|error:|\bE[A-Z]{2,}\b|internal server/i.test(text);
  }
}
