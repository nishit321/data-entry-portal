import { Module } from '@nestjs/common';
import { ReportingPeriodsService } from './reporting-periods.service';
import { ReportingPeriodsController } from './reporting-periods.controller';
import { EnforcementModule } from '../enforcement/enforcement.module';

@Module({
  // Closing a period runs the compliance sweep for it, so we depend on the enforcement engine.
  imports: [EnforcementModule],
  controllers: [ReportingPeriodsController],
  providers: [ReportingPeriodsService],
  exports: [ReportingPeriodsService],
})
export class ReportingPeriodsModule {}
