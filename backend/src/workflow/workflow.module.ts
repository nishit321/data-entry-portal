import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

/** The Checker → Verifier → Approver review workflow over submitted returns (Q1/Q2). */
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
