import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import configuration, { ThrottleConfig } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EntitiesModule } from './entities/entities.module';
import { AgentsModule } from './agents/agents.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { TemplatesModule } from './templates/templates.module';
import { ReportingPeriodsModule } from './reporting-periods/reporting-periods.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { WorkflowModule } from './workflow/workflow.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EnforcementModule } from './enforcement/enforcement.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BenchmarkingModule } from './benchmarking/benchmarking.module';
import { PublicPortalModule } from './public-portal/public-portal.module';
import { ReportsModule } from './reports/reports.module';
import { GeoModule } from './geo/geo.module';
import { MachineApiModule } from './machine-api/machine-api.module';
import { SignaturesModule } from './signatures/signatures.module';
import { FeedsModule } from './feeds/feeds.module';
import { LevyModule } from './levy/levy.module';
import { ExportsModule } from './exports/exports.module';
import { DocumentsModule } from './documents/documents.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // Baseline rate limiting across the whole API (brute-force protection).
    // Skipped only under NODE_ENV=test so multi-request e2e cases (lockout, etc.)
    // aren't throttled first; always active in dev/production.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const t = config.get<ThrottleConfig>('throttle')!;
        return {
          throttlers: [{ ttl: t.ttlSec * 1000, limit: t.limit }],
          // User-facing message when the rate limit trips (never the raw class name).
          errorMessage: 'Too many attempts. Please wait a moment and try again.',
          skipIf: () => process.env.NODE_ENV === 'test',
        };
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    MailModule,
    AuthModule,
    UsersModule,
    EntitiesModule,
    AgentsModule,
    ReferenceDataModule,
    TemplatesModule,
    ReportingPeriodsModule,
    SubmissionsModule,
    WorkflowModule,
    NotificationsModule,
    EnforcementModule,
    AnalyticsModule,
    BenchmarkingModule,
    PublicPortalModule,
    ReportsModule,
    GeoModule,
    MachineApiModule,
    SignaturesModule,
    FeedsModule,
    LevyModule,
    ExportsModule,
    DocumentsModule,
    ComplaintsModule,
    SchedulerModule,
    FilesModule,
    HealthModule,
  ],
  providers: [
    // Guard order matters: rate-limit, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
