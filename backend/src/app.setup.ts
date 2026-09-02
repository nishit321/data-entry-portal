import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { API_PREFIX, API_VERSION, REQUEST_ID_HEADER } from './common/constants/app.constants';

/**
 * Apply every global concern in one place so production (main.ts) and the e2e
 * tests configure the app identically — the tests exercise the real request
 * pipeline (guards, versioning, validation, error envelope), not a stripped-down
 * one. Pass corsOrigins only where CORS should be enabled (i.e. the server).
 */
export function configureApp(app: INestApplication, corsOrigins?: string[]): void {
  app.use(helmet());

  // Explicit request body limit. Comfortably covers the largest legitimate payload (a full
  // submission save is capped at 1000 values by SaveValuesDto) while rejecting oversized bodies.
  //
  // The machine API signs the request *body*, so it needs the bytes that arrived, not the object
  // they parsed into. `JSON.stringify(req.body)` is not the same string — key order, whitespace and
  // number formatting all differ — and a signature over a re-serialised body would fail for honest
  // callers and pass for some dishonest ones. `verify` runs before parsing and hands us the raw
  // buffer; it is kept only for machine routes, so an ordinary request carries no extra copy.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        if (
          (req as Request).path?.startsWith(`/${API_PREFIX}/`) &&
          (req as Request).path.includes('/machine/')
        ) {
          (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Correlation id per request (reuse an incoming one), echoed back.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    req.headers[REQUEST_ID_HEADER] = id;
    res.setHeader('X-Request-Id', id);
    next();
  });

  // Configuration, not a constant: the right number is however many proxies the deployment puts in
  // front, and getting it wrong is silent either way. Too few and every caller looks like the
  // proxy, so one operator's traffic rate-limits everyone. Too many and a caller can put whatever
  // they like in X-Forwarded-For and the audit log believes it.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }
}
