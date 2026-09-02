import { Module } from '@nestjs/common';
import { LevyController } from './levy.controller';
import { LevyService } from './levy.service';

/** Revenue-levy (Q14): configurable levy rates and revenue-based assessments over approved returns. */
@Module({
  controllers: [LevyController],
  providers: [LevyService],
  exports: [LevyService],
})
export class LevyModule {}
