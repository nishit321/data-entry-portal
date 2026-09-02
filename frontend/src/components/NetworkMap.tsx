import { useEffect, useId, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPoint } from '../lib/types';
import { MAP_KIND_COLOURS, MAP_KIND_LABELS } from './map-legend';
import { describeMap } from './map-summary';

/**
 * Where the basemap tiles come from.
 *
 * Deliberately empty by default. Pointing this at a public tile service would send the coordinates
 * of every mast a reader looks at to a third party, which is exactly what Q5 rules out: NCA's data
 * and the keys to it stay under NCA's control. Set `VITE_MAP_TILE_URL` to NCA's own tile server and
 * the basemap appears; leave it unset and the map still plots every point, on a plain ground.
 */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? '';
const TILE_ATTRIBUTION = import.meta.env.VITE_MAP_TILE_ATTRIBUTION ?? '';

/** Juba, so an empty map opens somewhere in South Sudan rather than in the Atlantic. */
const DEFAULT_CENTRE: [number, number] = [4.8594, 31.5713];
const DEFAULT_ZOOM = 7;

/** Escape anything that came from a database before it goes into a popup as HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The network map.
 *
 * Leaflet rather than a vector-tile engine, for two reasons that both come back to where this runs:
 * it is a fraction of the download over a connection that may be slow, and it draws plain raster
 * tiles, which is far and away the easiest thing for NCA to host itself.
 *
 * Points are drawn as circle markers rather than image pins so the map carries no icon assets at
 * all, and a coverage radius is drawn as a circle in real metres so it stays honest as you zoom.
 */
export function NetworkMap({
  points,
  showCoverage,
  className = '',
  listedIn,
}: {
  points: MapPoint[];
  showCoverage: boolean;
  className?: string;
  /** Where the same points can be read as text, named so the summary can send a reader there. */
  listedIn?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const summary = useMemo(() => describeMap(points, listedIn), [points, listedIn]);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Create the map once. Recreating it on every render would drop the reader's pan and zoom.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTRE,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: false,
    });
    if (TILE_URL) {
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    }
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw the points whenever they change, leaving the map itself alone.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const point of points) {
      const colour = MAP_KIND_COLOURS[point.kind] ?? MAP_KIND_COLOURS.OTHER;

      if (showCoverage && point.coverageM && point.coverageM > 0) {
        L.circle([point.lat, point.lng], {
          radius: point.coverageM,
          color: colour,
          weight: 1,
          opacity: 0.35,
          fillOpacity: 0.08,
        }).addTo(layer);
      }

      L.circleMarker([point.lat, point.lng], {
        radius: point.kind === 'AGENT' ? 4 : 6,
        color: colour,
        weight: 2,
        fillColor: colour,
        fillOpacity: 0.8,
      })
        .bindPopup(
          `<strong>${escapeHtml(point.name)}</strong><br>` +
            `${escapeHtml(MAP_KIND_LABELS[point.kind] ?? 'Site')}<br>` +
            `<span style="color:#6b7280">${escapeHtml(point.entity.name)}</span>`,
        )
        .addTo(layer);
    }

    // Frame whatever is on the map, so a reader is never left staring at the wrong continent.
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [points, showCoverage]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="h-[28rem] w-full rounded-lg border border-gray-200 bg-gray-100"
        role="application"
        aria-label="Network map"
        aria-describedby={summaryId}
      />

      {/*
        Off-screen rather than hidden: a screen reader reads it, and the map still looks like a map.
        The count alone used to be the whole alternative, which told a reader that something was
        there and nothing about what.
      */}
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      {!TILE_URL && (
        <p className="mt-2 text-xs text-gray-500">
          No basemap is configured, so locations are plotted on a plain background. Set a tile
          server address to show streets and terrain.
        </p>
      )}
    </div>
  );
}
