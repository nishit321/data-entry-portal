import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ExportsModule } from '../exports/exports.module';

/**
 * Scheduled sector reports (Phase 2). Builds on the exports the Authority can already download and
 * puts them on a timetable. Exported so the scheduler can run the hourly check.
 */
@Module({
  imports: [ExportsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
