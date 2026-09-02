import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { WorkflowService } from './workflow.service';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { WorkflowQueueQueryDto } from './dto/workflow-queue.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

const REVIEWERS = [Role.CHECKER, Role.VERIFIER, Role.APPROVER] as const;

/**
 * The review workflow (Q1). Reviewers (Checker/Verifier/Approver) work their queue and record a
 * decision at their own stage; the full review history is readable by any Authority role.
 */
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  /** The returns waiting at the caller's review stage. */
  @Get('queue')
  @Roles(...REVIEWERS)
  queue(@CurrentUser() user: AuthUser, @Query() query: WorkflowQueueQueryDto) {
    return this.workflow.queue(user, query);
  }

  /** The review timeline of a return — Authority-only (operators never see reviewer comments). */
  @Get(':id/history')
  @Roles(...AUTHORITY_ROLES)
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflow.history(id);
  }

  /** Approve or reject a return at the caller's stage. */
  @Post(':id/decision')
  @Roles(...REVIEWERS)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDecisionDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.workflow.decide(user, id, dto, ctx);
  }
}
