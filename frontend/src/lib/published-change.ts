import type { PublicPoint } from './types';

/**
 * How a published figure has moved, for the public pages.
 *
 * The disclosure rule shapes this more than the arithmetic does. A period is withheld when too few
 * operators reported it, and a withheld period must stay withheld: it can be neither an endpoint of
 * the comparison nor inferable from one. So the change is always measured between two figures that
 * are already public, and the earlier one is named rather than assumed, because the period in
 * between may be the one that was held back.
 */
export interface PublishedChange {
  current: PublicPoint;
  previous: PublicPoint;
  /** Relative change between the two published figures. 0.12 means twelve percent higher. */
  change: number;
}

function isPublished(point: PublicPoint): boolean {
  return !point.withheld && point.value !== null;
}

/**
 * The newest published figure against the most recent published figure before it.
 *
 * Null when there is nothing to compare: a single published period, or an earlier one of zero,
 * which has no percentage to give. The chart above already carries the figures themselves, so
 * saying nothing is better than saying something that needs a footnote.
 */
export function latestPublishedChange(points: readonly PublicPoint[]): PublishedChange | null {
  const published = points.filter(isPublished);
  const current = published[published.length - 1];
  const previous = published[published.length - 2];
  if (!current || !previous) return null;

  const from = previous.value as number;
  const to = current.value as number;
  if (from === 0) return null;

  return { current, previous, change: (to - from) / from };
}

/** "Up 12% on 2026 Q1", or "Unchanged from 2026 Q1". */
export function describePublishedChange(moved: PublishedChange): string {
  const percent = Math.round(moved.change * 100);
  if (percent === 0) return `Unchanged from ${moved.previous.label}`;
  return `${percent > 0 ? 'Up' : 'Down'} ${Math.abs(percent)}% on ${moved.previous.label}`;
}
