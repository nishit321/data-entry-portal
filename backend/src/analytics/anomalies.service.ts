import { Injectable } from '@nestjs/common';
import { FieldType, Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { entityScopeFilter } from '../common/utils/data-scope.util';
import {
  DEFAULT_DETECTION,
  detectAnomaly,
  type Anomaly,
  type SeriesPoint,
} from './anomaly-detection';
import { AnomalyQueryDto } from './dto/analytics-query.dto';
import { detectStatistical, type StatisticalFinding } from './statistical-anomaly';

/** Only figures can move implausibly; text and dates are not in scope. */
const NUMERIC_TYPES: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

/**
 * A bound on how many returns one sweep reads. Comfortably above any real filing history (Q11: a
 * handful of operators over a few years), and there so a misconfigured template cannot turn this
 * into an unbounded scan. The read is newest-first, so if the bound ever does bind it is the
 * distant past that falls off the end rather than the periods anyone is looking at.
 */
const MAX_SUBMISSIONS = 20_000;

/** Everything but the finding itself: what the figure was, whose it is, and where to go and see it. */
interface RowContext {
  entity: { id: string; name: string };
  period: { id: string; label: string; dueDate: Date };
  field: { key: string; label: string; unit: string | null };
  template: { name: string };
  submissionId: string;
  status: SubmissionStatus;
}

/** A flag as the Authority reads it: what moved, whose it is, and why it was picked up. */
export interface AnomalyRow extends RowContext {
  anomaly: Anomaly;
  /**
   * The statistical layer's view of the same figure (Phase 3), when it has one.
   *
   * Carried alongside the threshold flag rather than replacing it. The two answer different
   * questions — "did this move a lot?" and "is this unusual *for this series*?" — and a reviewer
   * reading a flag is better served by both than by whichever one happened to fire.
   */
  statistical?: StatisticalFinding | null;
}

/**
 * Trend and anomaly flags over filed returns (Phase 2).
 *
 * Computed live rather than stored, which is how analytics and the levy assessment already work in
 * this codebase. It keeps the flags honest — revise a return and the flag moves with it, with no
 * stale table to reconcile — and at this sector's size the scan is cheap. If the data ever outgrows
 * that, this is the seam to put a materialised table behind.
 *
 * The baseline is drawn from **approved** figures only, but a flag is raised against **any** filed
 * return. That ordering is deliberate: a reviewer holding a return is exactly who can act on it,
 * and an unreviewed figure has no business setting the baseline that later figures are judged by.
 */
@Injectable()
export class AnomaliesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: AuthUser, query: AnomalyQueryDto) {
    const scoped = entityScopeFilter(user); // operator → own id; authority → undefined
    const entityId = scoped ?? query.entityId;

    const where: Prisma.SubmissionWhereInput = {
      deletedAt: null,
      // Superseded versions are history; judging a return against a figure that was later revised
      // would flag movements the operator has already corrected.
      supersededBy: null,
      entityId,
      templateId: query.templateId,
      submittedAt: { not: null },
      status: { not: SubmissionStatus.REJECTED },
    };

    const submissions = await this.prisma.submission.findMany({
      where,
      select: {
        id: true,
        status: true,
        entity: { select: { id: true, name: true } },
        period: { select: { id: true, label: true, dueDate: true } },
        template: { select: { name: true } },
        values: {
          where: {
            isUnavailable: false,
            valueText: { not: null },
            field: { dataType: { in: NUMERIC_TYPES } },
          },
          select: {
            valueText: true,
            field: { select: { key: true, label: true, unit: true } },
          },
        },
      },
      orderBy: { period: { dueDate: 'desc' } },
      take: MAX_SUBMISSIONS,
    });

    const options = {
      ...DEFAULT_DETECTION,
      thresholdPercent: query.thresholdPercent ?? DEFAULT_DETECTION.thresholdPercent,
    };

    // Group into one series per (entity, template family, question). Template *name* rather than id
    // is the family key, exactly as the compliance streak does: publishing a new version of a
    // questionnaire must not restart every operator's history.
    const seriesByKey = new Map<string, { points: SeriesPoint[]; rows: Map<string, RowContext> }>();

    for (const sub of submissions) {
      for (const value of sub.values) {
        const parsed = Number(value.valueText);
        if (!Number.isFinite(parsed)) continue;

        const key = `${sub.entity.id}::${sub.template.name}::${value.field.key}`;
        let entry = seriesByKey.get(key);
        if (!entry) {
          entry = { points: [], rows: new Map() };
          seriesByKey.set(key, entry);
        }
        entry.points.push({
          periodId: sub.period.id,
          periodLabel: sub.period.label,
          dueDate: sub.period.dueDate,
          value: parsed,
          approved: sub.status === SubmissionStatus.APPROVED,
        });
        entry.rows.set(sub.period.id, {
          entity: sub.entity,
          period: sub.period,
          field: value.field,
          template: { name: sub.template.name },
          submissionId: sub.id,
          status: sub.status,
        });
      }
    }

    const found: AnomalyRow[] = [];
    for (const { points, rows } of seriesByKey.values()) {
      const latest = [...points].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).pop()!;
      const row = rows.get(latest.periodId);
      if (!row) continue;

      // The statistical layer runs on every series, not only on ones the threshold already caught:
      // a slow drift and a broken seasonal pattern are exactly the movements no threshold sees.
      const statistical = detectStatistical(points);
      const anomaly = detectAnomaly(points, options);

      if (anomaly) {
        if (anomaly.kind === 'FIRST_REPORT' && !query.includeFirstReports) continue;
        found.push({ ...row, anomaly, statistical });
        continue;
      }

      // Nothing from the threshold rule, but the statistics found something. Surfaced as a flag in
      // its own right, described in the same shape so one list reads consistently.
      if (statistical) {
        found.push({
          ...row,
          anomaly: {
            kind:
              statistical.kind === 'SEASONAL_BREAK'
                ? 'SEASONAL_BREAK'
                : statistical.kind === 'DRIFT'
                  ? 'DRIFT'
                  : 'SPIKE',
            severity: statistical.severity,
            value: statistical.value,
            baseline: statistical.expected,
            baselineSize: statistical.historySize,
            changePercent: null,
            explanation: statistical.explanation,
          },
          statistical,
        });
      }
    }

    const filtered = query.severity
      ? found.filter((r) => r.anomaly.severity === query.severity)
      : found;

    // Worst first, then most recent: an analyst works down this list from the top.
    filtered.sort((a, b) => {
      if (a.anomaly.severity !== b.anomaly.severity) return a.anomaly.severity === 'HIGH' ? -1 : 1;
      return b.period.dueDate.getTime() - a.period.dueDate.getTime();
    });

    return {
      total: filtered.length,
      high: filtered.filter((r) => r.anomaly.severity === 'HIGH').length,
      thresholdPercent: options.thresholdPercent,
      rows: filtered.slice(0, query.limit ?? 100),
    };
  }
}
