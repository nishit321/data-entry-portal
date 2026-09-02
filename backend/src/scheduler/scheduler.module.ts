import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { MachineApiModule } from '../machine-api/machine-api.module';
import { FeedsModule } from '../feeds/feeds.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { EnforcementModule } from '../enforcement/enforcement.module';
import { DocumentsModule } from '../documents/documents.module';

/**
 * Runs the periodic work the other modules already expose: the compliance sweep, the document
 * expiry sweep, the notification email retry, the penalty accrual, and the scheduled sector
 * reports. It owns no domain logic of its own — it decides only *when*, so each job stays testable
 * and runnable by hand.
 */
@Module({
  imports: [ReportsModule, MachineApiModule, FeedsModule, EnforcementModule, DocumentsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
