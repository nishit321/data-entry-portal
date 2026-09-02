import { Module } from '@nestjs/common';
import { ApiClientsController } from './api-clients.controller';
import { ApiClientsService } from './api-clients.service';
import { MachineController } from './machine.controller';
import { MachineApiService } from './machine-api.service';
import { MachineAuthGuard } from './machine-auth.guard';
import { SubmissionsModule } from '../submissions/submissions.module';

/**
 * The system-to-system API (Q10, Phase 3): the credentials operators are issued, and the narrow
 * surface their systems file through.
 *
 * Depends on SubmissionsModule rather than the database, because a machine filing must meet exactly
 * the rules a person's filing meets — the same service, not a copy of it.
 */
@Module({
  imports: [SubmissionsModule],
  controllers: [ApiClientsController, MachineController],
  providers: [ApiClientsService, MachineApiService, MachineAuthGuard],
  exports: [ApiClientsService],
})
export class MachineApiModule {}
