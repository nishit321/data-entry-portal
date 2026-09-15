import type { MapPoint, MapRoute } from '../lib/types';
import { MAP_KIND_LABELS } from './map-legend';

/**
 * What this map says, in words (FRONTEND_STANDARDS §6).
 *
 * A map cannot be described point by point without becoming a worse version of the register that
 * already lists them. What it *can* say is what it is showing and roughly in what proportion, which
 * is what a sighted reader takes from it at a glance, and then send the reader to the register for
 * the detail.
 */
export function describeMap(
  points: MapPoint[],
  listedIn?: string,
  routes: MapRoute[] = [],
): string {
  if (points.length === 0 && routes.length === 0) {
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

  /*
   * How many routes, and how many of them are only the straight line.
   *
   * The second number is the one a reader cannot get any other way. Sighted readers see it in the
   * dashes; described without it, a map of eight guessed routes would read as eight surveyed ones.
   */
  const indicative = routes.filter((r) => !r.surveyed).length;
  const routeLine =
    routes.length === 0
      ? null
      : `${routes.length} fibre ${routes.length === 1 ? 'route' : 'routes'}` +
        (indicative === 0
          ? ', all surveyed.'
          : indicative === routes.length
            ? ', none of them surveyed: each is drawn as a straight line between its two nodes.'
            : `, ${indicative} of them drawn as a straight line because no survey was supplied.`);

  return [
    points.length > 0 &&
      `Network map. ${points.length} ${points.length === 1 ? 'location' : 'locations'} ${whose}: ${kinds}.`,
    points.length === 0 && 'Network map. No locations match the current filters.',
    routeLine,
    listedIn && `The same locations are listed in ${listedIn}.`,
  ]
    .filter(Boolean)
    .join(' ');
}
