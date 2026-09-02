import { Module } from '@nestjs/common';
import { BenchmarkingController } from './benchmarking.controller';
import { BenchmarkingService } from './benchmarking.service';

/** Operator comparison against peers (Phase 2), with disclosure control in `peer-statistics`. */
@Module({
  controllers: [BenchmarkingController],
  providers: [BenchmarkingService],
  exports: [BenchmarkingService],
})
export class BenchmarkingModule {}
