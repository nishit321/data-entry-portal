import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  ReviewDecision,
  ReviewStage,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { submissionDetailSelect, submissionListSelect } from '../submissions/submissions.constants';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { WorkflowQueueQueryDto } from './dto/workflow-queue.dto';

/** Which review stage each reviewer role acts on (Q1). */
const STAGE_BY_ROLE: Partial<Record<Role, ReviewStage>> = {
  [Role.CHECKER]: ReviewStage.CHECKER,
  [Role.VERIFIER]: ReviewStage.VERIFIER,
  [Role.APPROVER]: ReviewStage.APPROVER,
};

/** The next stage after a stage approves (APPROVER is terminal). */
const NEXT_STAGE: Record<ReviewStage, ReviewStage | null> = {
  [ReviewStage.CHECKER]: ReviewStage.VERIFIER,
  [ReviewStage.VERIFIER]: ReviewStage.APPROVER,
  [ReviewStage.APPROVER]: null,
};

/**
 * The Checker → Verifier → Approver review workflow (Q1/Q2). Reviewers act only at their own stage,
 * a single person can't take two stages on one return (separation of duties), an approval advances
 * or finally locks the return, and a rejection sends it back to the operator with a reason.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private stageForRole(role: Role): ReviewStage {
    const stage = STAGE_BY_ROLE[role];
    if (!stage) {
      throw new ForbiddenException('Only Checker, Verifier, or Approver users can review returns.');
    }
    return stage;
  }

  /** The returns waiting at the caller's review stage — their work queue, paginated + filterable. */
  async queue(user: AuthUser, query: WorkflowQueueQueryDto) {
    const stage = this.stageForRole(user.role);
    const where: Prisma.SubmissionWhereInput = {
      deletedAt: null,
      reviewStage: stage,
      status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
      entityId: query.entityId,
      templateId: query.templateId,
      periodId: query.periodId,
      isLate: query.isLate === undefined ? undefined : query.isLate === 'true',
      ...(query.search ? { referenceNumber: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const orderBy = { [query.sort]: query.order } as Prisma.SubmissionOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.submission.findMany({ where, select: submissionListSelect, orderBy, skip, take }),
      this.prisma.submission.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  /** Record a decision at the caller's stage and move the return forward, lock it, or reject it. */
  async decide(user: AuthUser, submissionId: string, dto: ReviewDecisionDto, ctx: RequestContext) {
    const stage = this.stageForRole(user.role);
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: {
        id: true,
        status: true,
        reviewStage: true,
        entityId: true,
        isLate: true,
        referenceNumber: true,
        entity: { select: { name: true } },
        template: { select: { name: true } },
        reviewSteps: { select: { actorId: true } },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    if (
      !submission.reviewStage ||
      (submission.status !== SubmissionStatus.SUBMITTED &&
        submission.status !== SubmissionStatus.UNDER_REVIEW)
    ) {
      throw new BadRequestException('This return is not awaiting review.');
    }
    if (submission.reviewStage !== stage) {
      throw new BadRequestException('This return is not at your review stage.');
    }
    // Separation of duties: a reviewer who already acted on this return can't take another stage.
    if (submission.reviewSteps.some((s) => s.actorId === user.id)) {
      throw new ForbiddenException(
        'You have already reviewed this return at an earlier stage, so you cannot review it again.',
      );
    }

    const comment = dto.comment?.trim();
    if (dto.decision === ReviewDecision.REJECT && !comment) {
      throw new BadRequestException('A reason is required to reject a return.');
    }

    await this.prisma.reviewStep.create({
      data: { submissionId, stage, decision: dto.decision, actorId: user.id, comment },
    });

    if (dto.decision === ReviewDecision.REJECT) {
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: SubmissionStatus.REJECTED,
          reviewStage: null,
          rejectionReason: comment,
        },
      });
      await this.resetStreak(submission.entityId, submission.template.name);
      await this.record(AuditAction.SUBMISSION_REJECTED, submissionId, user.id, ctx, { stage });
      await this.notifications.returnDecision({
        submissionId,
        entityId: submission.entityId,
        approved: false,
        referenceNumber: submission.referenceNumber,
        rejectionReason: comment,
      });
      return this.detail(submissionId);
    }

    // Approve.
    const next = NEXT_STAGE[stage];
    if (next) {
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.UNDER_REVIEW, reviewStage: next },
      });
      await this.record(AuditAction.SUBMISSION_REVIEWED, submissionId, user.id, ctx, {
        stage,
        advancedTo: next,
      });
      // Hand it to the next stage's reviewers.
      await this.notifications.returnAwaitingReview({
        submissionId,
        stage: next,
        referenceNumber: submission.referenceNumber,
        entityName: submission.entity.name,
      });
      return this.detail(submissionId);
    }

    // Approver sign-off — final. Lock the return; extend the clean streak only if it was on time
    // (a late period isn't "clean", so it must not count toward the fast-track threshold — Q2).
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.APPROVED, reviewStage: null, lockedAt: new Date() },
    });
    if (!submission.isLate) {
      await this.incrementStreak(submission.entityId, submission.template.name);
    }
    await this.record(AuditAction.SUBMISSION_APPROVED, submissionId, user.id, ctx, { stage });
    await this.notifications.returnDecision({
      submissionId,
      entityId: submission.entityId,
      approved: true,
      referenceNumber: submission.referenceNumber,
    });
    return this.detail(submissionId);
  }

  /** The full review history of a return (Authority-only) — every stage, decision, and comment. */
  async history(submissionId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { id: true, status: true, reviewStage: true },
    });
    if (!submission) throw new NotFoundException('Return not found');

    const steps = await this.prisma.reviewStep.findMany({
      where: { submissionId },
      // Latest decision first — the most recent action sits at the top of the timeline.
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        stage: true,
        decision: true,
        comment: true,
        actorId: true,
        createdAt: true,
      },
    });
    // actorId isn't a Prisma relation on ReviewStep, so resolve the reviewer names in one query.
    const actorIds = [...new Set(steps.map((s) => s.actorId))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });
    const actorById = new Map(actors.map((a) => [a.id, a]));
    return {
      id: submission.id,
      status: submission.status,
      reviewStage: submission.reviewStage,
      steps: steps.map(({ actorId, ...s }) => ({ ...s, actor: actorById.get(actorId) ?? null })),
    };
  }

  private detail(id: string) {
    return this.prisma.submission.findFirst({ where: { id }, select: submissionDetailSelect });
  }

  private incrementStreak(entityId: string, templateName: string) {
    return this.prisma.complianceStreak.upsert({
      where: { entityId_templateName: { entityId, templateName } },
      create: { entityId, templateName, count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  private resetStreak(entityId: string, templateName: string) {
    return this.prisma.complianceStreak.upsert({
      where: { entityId_templateName: { entityId, templateName } },
      create: { entityId, templateName, count: 0 },
      update: { count: 0 },
    });
  }

  private record(
    action: AuditAction,
    submissionId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'Submission',
      entityId: submissionId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
