import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { configureApp } from './app.setup';
import { API_PREFIX, API_VERSION } from './common/constants/app.constants';

async function bootstrap() {
  // bodyParser:false disables Nest's default (100 kb) parser so the explicit 2 MB json/urlencoded
  // parsers registered in configureApp are the ones that actually govern request size.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, bodyParser: false });
  const config = app.get(ConfigService);
  const appConfig = config.get<AppConfig>('app')!;

  // Every global concern (helmet, requestId, prefix, versioning, validation,
  // error envelope, logging, CORS) lives in configureApp so tests match prod.
  configureApp(app, appConfig.corsOrigins);
  app.enableShutdownHooks();

  await app.listen(appConfig.port);
  Logger.log(
    `Backend running on http://localhost:${appConfig.port}/${API_PREFIX}/v${API_VERSION}`,
    'Bootstrap',
  );
}

bootstrap();
