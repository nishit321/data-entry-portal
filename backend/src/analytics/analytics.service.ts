import { Injectable } from '@nestjs/common';
import { EnforcementStatus, Prisma, ReviewStage, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { entityScopeFilter } from '../common/utils/data-scope.util';
import { AnalyticsQueryDto, TrendsQueryDto } from './dto/analytics-query.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The base filter over returns for a reader: only current versions (a superseded, rejected
   * version never double-counts), scoped to the operator's own entity, and narrowed by any
   * Authority-supplied entity/template/period filter.
   */
  private submissionWhere(user: AuthUser, query: AnalyticsQueryDto): Prisma.SubmissionWhereInput {
    const scoped = entityScopeFilter(user); // operator → own id; authority → undefined
    return {
      deletedAt: null,
      supersededBy: null,
      entityId: scoped ?? query.entityId,
      templateId: query.templateId,
      periodId: query.periodId,
    };
  }

  /** Headline compliance figures for the dashboard, all computed in aggregate (no row fetching). */
  async summary(user: AuthUser, query: AnalyticsQueryDto) {
    const where = this.submissionWhere(user, query);
    const scoped = entityScopeFilter(user);

    const [byStatus, byTimeliness, byStage, byCaseStatus] = await Promise.all([
      this.prisma.submission.groupBy({
        by: ['status'],
        where,
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.submission.groupBy({
        by: ['isLate'],
        where: { ...where, submittedAt: { not: null } },
        _count: true,
        orderBy: { isLate: 'asc' },
      }),
      this.prisma.submission.groupBy({
        by: ['reviewStage'],
        where: {
          ...where,
          status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
        },
        _count: true,
        orderBy: { reviewStage: 'asc' },
      }),
      this.prisma.enforcementCase.groupBy({
        by: ['status'],
        where: { entityId: scoped ?? query.entityId, periodId: query.periodId },
        _count: true,
        orderBy: { status: 'asc' },
      }),
    ]);

    const statusCount = (s: SubmissionStatus) => byStatus.find((r) => r.status === s)?._count ?? 0;
    const stageCount = (s: ReviewStage) => byStage.find((r) => r.reviewStage === s)?._count ?? 0;
    const caseCount = (s: EnforcementStatus) =>
      byCaseStatus.find((r) => r.status === s)?._count ?? 0;

    const approved = statusCount(SubmissionStatus.APPROVED);
    const rejected = statusCount(SubmissionStatus.REJECTED);
    const decided = approved + rejected;
    const onTime = byTimeliness.find((r) => r.isLate === false)?._count ?? 0;
    const late = byTimeliness.find((r) => r.isLate === true)?._count ?? 0;

    return {
      submissions: {
        total: byStatus.reduce((sum, r) => sum + r._count, 0),
        draft: statusCount(SubmissionStatus.DRAFT),
        submitted: statusCount(SubmissionStatus.SUBMITTED),
        underReview: statusCount(SubmissionStatus.UNDER_REVIEW),
        approved,
        rejected,
      },
      timeliness: { onTime, late },
      // Returns currently waiting at each review stage.
      pipeline: {
        checker: stageCount(ReviewStage.CHECKER),
        verifier: stageCount(ReviewStage.VERIFIER),
        approver: stageCount(ReviewStage.APPROVER),
      },
      compliance: {
        open: caseCount(EnforcementStatus.OPEN),
        resolved: caseCount(EnforcementStatus.RESOLVED),
        waived: caseCount(EnforcementStatus.WAIVED),
      },
      // Share of decided returns that were approved (null when nothing is decided yet).
      approvalRate: decided > 0 ? approved / decided : null,
    };
  }

  /**
   * A short time series over the most recent reporting periods: how many returns were filed for
   * each, and the on-time / late split. Drives the compliance trend chart.
   */
  async trends(user: AuthUser, query: TrendsQueryDto) {
    const periodWhere: Prisma.ReportingPeriodWhereInput = {
      deletedAt: null,
      templateId: query.templateId,
      id: query.periodId,
    };
    // Newest first for "recent N", then present oldest → newest so the chart reads left to right.
    const recent = await this.prisma.reportingPeriod.findMany({
      where: periodWhere,
      orderBy: { dueDate: 'desc' },
      take: query.periods,
      select: { id: true, label: true, dueDate: true },
    });
    if (recent.length === 0) return { periods: [] };
    const periodIds = recent.map((p) => p.id);

    const base = this.submissionWhere(user, { ...query, periodId: undefined });
    const scopedWhere: Prisma.SubmissionWhereInput = {
      ...base,
      periodId: { in: periodIds },
      submittedAt: { not: null },
    };

    const [byStatus, byTimeliness] = await Promise.all([
      this.prisma.submission.groupBy({
        by: ['periodId', 'status'],
        where: scopedWhere,
        _count: true,
        orderBy: { periodId: 'asc' },
      }),
      this.prisma.submission.groupBy({
        by: ['periodId', 'isLate'],
        where: scopedWhere,
        _count: true,
        orderBy: { periodId: 'asc' },
      }),
    ]);

    const periods = recent
      .slice()
      .reverse()
      .map((p) => {
        const status = (s: SubmissionStatus) =>
          byStatus.find((r) => r.periodId === p.id && r.status === s)?._count ?? 0;
        const onTime =
          byTimeliness.find((r) => r.periodId === p.id && r.isLate === false)?._count ?? 0;
        const late =
          byTimeliness.find((r) => r.periodId === p.id && r.isLate === true)?._count ?? 0;
        return {
          periodId: p.id,
          label: p.label,
          dueDate: p.dueDate,
          filed: onTime + late,
          onTime,
          late,
          approved: status(SubmissionStatus.APPROVED),
          rejected: status(SubmissionStatus.REJECTED),
        };
      });

    return { periods };
  }
}
