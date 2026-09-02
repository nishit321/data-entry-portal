import type { MapPoint } from '../lib/types';
import { MAP_KIND_LABELS } from './map-legend';

/**
 * What this map says, in words (FRONTEND_STANDARDS §6).
 *
 * A map cannot be described point by point without becoming a worse version of the register that
 * already lists them. What it *can* say is what it is showing and roughly in what proportion, which
 * is what a sighted reader takes from it at a glance, and then send the reader to the register for
 * the detail.
 */
export function describeMap(points: MapPoint[], listedIn?: string): string {
  if (points.length === 0) {
    return 'Network map. Nothing matches the current filters, so there is nothing plotted.';
  }

  const byKind = new Map<MapPoint['kind'], number>();
  const operators = new Set<string>();
  for (const point of points) {
    byKind.set(point.kind, (byKind.get(point.kind) ?? 0) + 1);
    operators.add(point.entity.id);
  }

  const kinds = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([kind, n]) =>
        `${n} ${(MAP_KIND_LABELS[kind] ?? 'location').toLowerCase()}${n === 1 ? '' : 's'}`,
    )
    .join(', ');

  const whose = operators.size === 1 ? 'for one operator' : `across ${operators.size} operators`;

  return [
    `Network map. ${points.length} ${points.length === 1 ? 'location' : 'locations'} ${whose}: ${kinds}.`,
    listedIn && `The same locations are listed in ${listedIn}.`,
  ]
    .filter(Boolean)
    .join(' ');
}
