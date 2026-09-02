import { Module } from '@nestjs/common';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';

/** Citizen complaint intake (Q4): public filing and tracking, plus the Authority's case list. */
@Module({
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
