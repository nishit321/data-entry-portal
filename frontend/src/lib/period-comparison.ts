import type { AnalyticsTrendPoint } from './types';

/*
 * Reading one reporting period against the one before it.
 *
 * One rule runs through this file and it is worth stating plainly: a count changes by a
 * percentage, a rate changes by percentage *points*. On-time filing that moves from 50% to 55%
 * has risen 5 points, not 10%, and reporting the second figure to a regulator would be a
 * misstatement. The two are kept in separate fields with separate words on screen so they cannot
 * be confused for each other.
 */

/** Of the operators that owed a return, how many filed one. Null when nobody owed anything. */
export function complianceRate(point: AnalyticsTrendPoint): number | null {
  if (point.expected <= 0) return null;
  // Capped, because a licence surrendered after filing leaves more returns than obligations, and
  // "104% compliant" is not a thing.
  return Math.min(1, point.filed / point.expected);
}

/** Of the returns that arrived, how many were on time. Null when none arrived. */
export function onTimeRate(point: AnalyticsTrendPoint): number | null {
  if (point.filed <= 0) return null;
  return point.onTime / point.filed;
}

export interface PeriodComparison {
  current: AnalyticsTrendPoint;
  previous: AnalyticsTrendPoint | null;
  /** Relative change in the number of returns filed. 0.2 means a fifth more than last period. */
  filedChange: number | null;
  complianceRate: number | null;
  /** Change in the compliance rate, in rate units. 0.05 means five points better. */
  complianceRatePoints: number | null;
  onTimeRate: number | null;
  /** Change in the on-time rate, in rate units. */
  onTimeRatePoints: number | null;
}

/**
 * Compare the newest period in a series against the one before it.
 *
 * The series is expected oldest first, which is how the trend endpoint returns it and how the
 * chart reads. Returns null for a single period, because there is nothing to compare it against
 * and an invented baseline of zero would report every first period as infinite growth.
 */
export function comparePeriods(points: readonly AnalyticsTrendPoint[]): PeriodComparison | null {
  const current = points[points.length - 1];
  if (!current) return null;
  const previous = points[points.length - 2] ?? null;

  const rate = complianceRate(current);
  const previousRate = previous ? complianceRate(previous) : null;
  const punctuality = onTimeRate(current);
  const previousPunctuality = previous ? onTimeRate(previous) : null;

  return {
    current,
    previous,
    // Division by a period in which nothing was filed has no answer, so say so rather than
    // reporting the first return of the year as a 100% rise.
    filedChange:
      previous && previous.filed > 0 ? (current.filed - previous.filed) / previous.filed : null,
    complianceRate: rate,
    complianceRatePoints: rate !== null && previousRate !== null ? rate - previousRate : null,
    onTimeRate: punctuality,
    onTimeRatePoints:
      punctuality !== null && previousPunctuality !== null
        ? punctuality - previousPunctuality
        : null,
  };
}

/** A whole-number percentage, or a dash when there is nothing to show. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * A relative change in words: "up 12%", "down 4%", "no change".
 *
 * Rounded before it is read, so a change of a third of a percent is reported as no change rather
 * than as an "up 0%" that reads like a rounding bug.
 */
export function formatRelativeChange(change: number | null): string | null {
  if (change === null) return null;
  const percent = Math.round(change * 100);
  if (percent === 0) return 'no change';
  return `${percent > 0 ? 'up' : 'down'} ${Math.abs(percent)}%`;
}

/** A change in a rate, counted in points: "up 5 points", "down 1 point", "no change". */
export function formatPointChange(change: number | null): string | null {
  if (change === null) return null;
  const points = Math.round(change * 100);
  if (points === 0) return 'no change';
  const size = Math.abs(points);
  return `${points > 0 ? 'up' : 'down'} ${size} ${size === 1 ? 'point' : 'points'}`;
}

/** Which way a change should read on screen. Neither good nor bad on its own. */
export function changeDirection(change: number | null): 'up' | 'down' | 'flat' | null {
  if (change === null) return null;
  const rounded = Math.round(change * 100);
  return rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down';
}
