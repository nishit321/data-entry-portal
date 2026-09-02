import type { MapPoint } from '../lib/types';

/**
 * The colour and name of each map layer.
 *
 * Kept out of `NetworkMap.tsx` so that file exports only its component: the page draws the legend
 * from the same two maps the map itself draws from, which is the point — a legend that can drift
 * out of step with the pins is worse than no legend.
 */
export const MAP_KIND_COLOURS: Record<MapPoint['kind'], string> = {
  BASE_STATION: '#2563eb',
  FIBRE_NODE: '#7c3aed',
  POP: '#0891b2',
  DATA_CENTRE: '#b45309',
  OTHER: '#64748b',
  AGENT: '#059669',
};

export const MAP_KIND_LABELS: Record<MapPoint['kind'], string> = {
  BASE_STATION: 'Base station',
  FIBRE_NODE: 'Fibre node',
  POP: 'Point of presence',
  DATA_CENTRE: 'Data centre',
  OTHER: 'Other site',
  AGENT: 'Agent',
};
