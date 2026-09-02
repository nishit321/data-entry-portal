import { Injectable } from '@nestjs/common';
import {
  ComplaintStatus,
  EntityStatus,
  FieldType,
  PublicAggregation,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_PEERS_FOR_DISCLOSURE } from '../benchmarking/peer-statistics';
import { PublicIndicatorQueryDto } from './dto/public-query.dto';

/**
 * The smallest number of operators an aggregate may rest on before it is published.
 *
 * The same threshold rule the benchmarking module uses, deliberately reading from the same constant
 * rather than a second copy: a sector total over two operators is two subtractions away from both
 * of their figures, and anyone who knows one of them knows the other.
 */
const MIN_CONTRIBUTORS = MIN_PEERS_FOR_DISCLOSURE;

/** How many periods of history the public series carries. Enough to show a direction. */
const MAX_PERIODS = 12;

const NUMERIC_TYPES: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

/** One period's figure for one published indicator. Never carries an operator. */
export interface PublicPoint {
  periodId: string;
  label: string;
  dueDate: Date;
  value: number | null;
  /** How many operators the figure rests on, so a reader can judge the coverage. */
  contributors: number;
  /** True when there were too few operators to publish without identifying one. */
  withheld: boolean;
}

/**
 * The public, unauthenticated view of the sector (Q4, Phase 2).
 *
 * Everything this service returns has passed three gates, and all three are here rather than in the
 * client, because a rule that a caller can skip is not a rule:
 *
 *  1. **Allowlist.** A figure is published only if an administrator has added it to
 *     `PublicIndicator` and switched it on. The default is that nothing is public.
 *  2. **Aggregate only.** There is no operator on any response shape below. Not filtered out —
 *     absent, so no future change to a query can accidentally let one through.
 *  3. **Threshold.** An aggregate resting on fewer than `MIN_CONTRIBUTORS` operators is withheld,
 *     because with one or two contributors a sector total is a company's figures in disguise.
 *
 * Two further rules follow from what publishing means. Only **approved** returns count: a figure
 * the Authority has not stood behind should not be on a public website. And only **closed** periods
 * are published: a figure from an open period can still be revised, and a public number that
 * changes next week is worse than one that arrives a month later.
 */
@Injectable()
export class PublicPortalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The published sector indicators, each with a short series over recent closed periods.
   *
   * Returns an empty list until NCA has decided what may be published, which is the correct
   * behaviour rather than a gap: nothing is public by default.
   */
  async indicators(query: PublicIndicatorQueryDto) {
    const indicators = await this.prisma.publicIndicator.findMany({
      where: { deletedAt: null, isPublished: true },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      select: {
        id: true,
        fieldKey: true,
        aggregation: true,
        label: true,
        unit: true,
        description: true,
      },
    });
    if (indicators.length === 0) {
      return { indicators: [], periods: [], threshold: MIN_CONTRIBUTORS };
    }

    const periods = await this.prisma.reportingPeriod.findMany({
      where: { deletedAt: null, status: 'CLOSED' },
      orderBy: { dueDate: 'desc' },
      take: query.periods ?? MAX_PERIODS,
      select: { id: true, label: true, dueDate: true },
    });
    if (periods.length === 0) {
      return { indicators: [], periods: [], threshold: MIN_CONTRIBUTORS };
    }

    const values = await this.prisma.submissionValue.findMany({
      where: {
        isUnavailable: false,
        valueText: { not: null },
        field: {
          key: { in: indicators.map((i) => i.fieldKey) },
          dataType: { in: NUMERIC_TYPES },
        },
        submission: {
          deletedAt: null,
          supersededBy: null,
          status: SubmissionStatus.APPROVED,
          periodId: { in: periods.map((p) => p.id) },
          // A deregistered operator's historic figures still belong in the sector total; a
          // soft-deleted record does not.
          entity: { deletedAt: null },
        },
      },
      select: {
        valueText: true,
        field: { select: { key: true } },
        submission: { select: { periodId: true, entityId: true } },
      },
    });

    // Group by (question, period), keeping one figure per operator so a revision cannot be
    // counted twice and an operator cannot weigh double in an average.
    const byKey = new Map<string, Map<string, number>>();
    for (const value of values) {
      const parsed = Number(value.valueText);
      if (!Number.isFinite(parsed)) continue;
      const key = `${value.field.key}::${value.submission.periodId}`;
      let entities = byKey.get(key);
      if (!entities) {
        entities = new Map();
        byKey.set(key, entities);
      }
      entities.set(value.submission.entityId, parsed);
    }

    // Oldest first, so the series reads left to right on a chart.
    const ordered = [...periods].reverse();

    return {
      threshold: MIN_CONTRIBUTORS,
      periods: ordered.map((p) => ({ id: p.id, label: p.label, dueDate: p.dueDate })),
      indicators: indicators.map((indicator) => ({
        id: indicator.id,
        label: indicator.label,
        unit: indicator.unit,
        description: indicator.description,
        aggregation: indicator.aggregation,
        points: ordered.map((period): PublicPoint => {
          const entities = byKey.get(`${indicator.fieldKey}::${period.id}`);
          const figures = entities ? [...entities.values()] : [];
          const withheld = figures.length < MIN_CONTRIBUTORS;
          return {
            periodId: period.id,
            label: period.label,
            dueDate: period.dueDate,
            value: withheld ? null : this.rollUp(figures, indicator.aggregation),
            contributors: figures.length,
            withheld,
          };
        }),
      })),
    };
  }

  /**
   * The complaint case book as the public may see it: how many came in, what they were about, and
   * how they were dealt with.
   *
   * Counts and durations only. No subject line, no description, no reference number, and nothing
   * that names the operator a complaint was about — a raw count against a named company is a
   * league table nobody agreed to publish.
   */
  async complaintsSummary() {
    const [byStatus, byCategory, resolved, total] = await Promise.all([
      this.prisma.complaint.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.complaint.groupBy({
        by: ['category'],
        _count: true,
        orderBy: { category: 'asc' },
      }),
      this.prisma.complaint.findMany({
        where: { resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        orderBy: { resolvedAt: 'desc' },
        take: 1000,
      }),
      this.prisma.complaint.count(),
    ]);

    const days = resolved
      .map((c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 86_400_000)
      .filter((d) => d >= 0);

    const statusCount = (status: ComplaintStatus) =>
      byStatus.find((r) => r.status === status)?._count ?? 0;

    return {
      total,
      byStatus: {
        received: statusCount(ComplaintStatus.RECEIVED),
        inReview: statusCount(ComplaintStatus.IN_REVIEW),
        resolved: statusCount(ComplaintStatus.RESOLVED),
        closed: statusCount(ComplaintStatus.CLOSED),
      },
      byCategory: byCategory.map((r) => ({ category: r.category, count: r._count })),
      resolution: {
        resolved: days.length,
        // Median, not mean: one case that sat for a year should not be allowed to describe the rest.
        medianDays: days.length > 0 ? Math.round(this.median(days) * 10) / 10 : null,
      },
    };
  }

  /** Headline figures for the top of the public page. Counts of operators, never their figures. */
  async overview() {
    const [operators, byType, periods] = await Promise.all([
      this.prisma.entity.count({ where: { deletedAt: null, status: EntityStatus.ACTIVE } }),
      this.prisma.entity.groupBy({
        by: ['type'],
        where: { deletedAt: null, status: EntityStatus.ACTIVE },
        _count: true,
        orderBy: { type: 'asc' },
      }),
      this.prisma.reportingPeriod.count({ where: { deletedAt: null, status: 'CLOSED' } }),
    ]);

    return {
      licensedOperators: operators,
      byType: byType.map((r) => ({ type: r.type, count: r._count })),
      periodsPublished: periods,
    };
  }

  private rollUp(figures: number[], aggregation: PublicAggregation): number {
    switch (aggregation) {
      case PublicAggregation.COUNT:
        return figures.length;
      case PublicAggregation.AVERAGE:
        return Math.round((figures.reduce((a, b) => a + b, 0) / figures.length) * 100) / 100;
      case PublicAggregation.SUM:
      default:
        return Math.round(figures.reduce((a, b) => a + b, 0) * 100) / 100;
    }
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
}
