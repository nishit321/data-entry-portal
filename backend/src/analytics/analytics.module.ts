import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnomaliesService } from './anomalies.service';

/** Aggregation layer (Q14): compliance KPIs and trend series over returns, segregation-aware. */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnomaliesService],
  exports: [AnalyticsService, AnomaliesService],
})
export class AnalyticsModule {}
