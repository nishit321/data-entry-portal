import { Module } from '@nestjs/common';
import { EnforcementController } from './enforcement.controller';
import { EnforcementService } from './enforcement.service';
import { PenaltyScheduleService } from './penalty-schedule.service';
import { PenaltyScheduleController } from './penalty-schedule.controller';
import { EnforcementOrdersService } from './enforcement-orders.service';

/**
 * The deadline / enforcement engine (Q3): the compliance sweep, the case records it opens, and the
 * penalty schedule those cases are priced under. Exports the service so reporting-periods can sweep
 * a period the moment it is closed, and the scheduler can run the nightly accrual.
 */
@Module({
  controllers: [EnforcementController, PenaltyScheduleController],
  providers: [EnforcementService, PenaltyScheduleService, EnforcementOrdersService],
  exports: [EnforcementService, PenaltyScheduleService],
})
export class EnforcementModule {}
