import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkMap } from './NetworkMap';
import { describeMap } from './map-summary';
import type { MapPoint } from '../lib/types';

/**
 * The map's text alternative.
 *
 * A map is the one thing in this product that cannot be read. Its accessible name used to be
 * "Network map showing 47 locations", which tells a reader that something is there and nothing at
 * all about what: the same amount of information as silence, delivered more politely.
 *
 * The wording is tested against `describeMap` directly rather than through a render, because
 * Leaflet needs real layout and cannot draw a marker in jsdom. The render below covers the wiring
 * on the one case that does not draw anything.
 */

function point(over: Partial<MapPoint> = {}): MapPoint {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'BASE_STATION',
    name: 'Site',
    lat: 4.85,
    lng: 31.58,
    entity: { id: 'e1', name: 'Alpha Telecom' },
    ...over,
  };
}

describe('the map summary', () => {
  it('says what is on the map, not just how much', () => {
    const summary = describeMap([
      point(),
      point(),
      point({ kind: 'FIBRE_NODE' }),
      point({ kind: 'AGENT', entity: { id: 'e2', name: 'Beta Telecom' } }),
    ]);

    expect(summary).toBe(
      'Network map. 4 locations across 2 operators: 2 base stations, 1 fibre node, 1 agent.',
    );
  });

  it('reads naturally for a single point', () => {
    expect(describeMap([point()])).toBe(
      'Network map. 1 location for one operator: 1 base station.',
    );
  });

  it('sends the reader to where the same points are readable', () => {
    expect(describeMap([point()], 'the site register below')).toContain(
      'The same locations are listed in the site register below.',
    );
  });

  it('says plainly when there is nothing on it', () => {
    expect(describeMap([])).toBe(
      'Network map. Nothing matches the current filters, so there is nothing plotted.',
    );
  });

  it('leads with whatever there is most of', () => {
    const summary = describeMap([
      point({ kind: 'AGENT' }),
      point({ kind: 'AGENT' }),
      point({ kind: 'AGENT' }),
      point({ kind: 'BASE_STATION' }),
    ]);

    expect(summary).toContain('3 agents, 1 base station');
  });
});

describe('NetworkMap', () => {
  it('attaches the summary to the map itself', () => {
    render(<NetworkMap showCoverage={false} points={[]} />);

    expect(screen.getByRole('application', { name: 'Network map' })).toHaveAccessibleDescription(
      'Network map. Nothing matches the current filters, so there is nothing plotted.',
    );
  });
});
