import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { LevyModule } from '../levy/levy.module';

/**
 * On-demand PDF/Excel exports. Depends on the analytics and levy modules rather than the database:
 * the scoped services are the single source of what a given reader may export.
 */
@Module({
  imports: [AnalyticsModule, LevyModule],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
