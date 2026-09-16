import { useEffect, useId, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPoint, MapRoute } from '../lib/types';
import { MAP_KIND_COLOURS, MAP_KIND_LABELS, ROUTE_COLOUR } from './map-legend';
import { describeMap } from './map-summary';

/**
 * Where the basemap tiles come from.
 *
 * NCA chose an open-source tile server (3 September 2026), and `.env.example` now points at
 * OpenStreetMap's. Worth stating the trade plainly rather than treating it as settled: mast
 * coordinates never leave the portal, but every tile request tells the tile server which part of
 * the map somebody is looking at — and NCA's operators look at their own masts. That is a
 * reasonable inference about where the Authority is working, sent to a third party.
 *
 * Running an OSM tile server inside NCA's own network answers it, and changes nothing else here.
 * Left unset, the map still plots every point on a plain ground rather than failing.
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
  routes = [],
  showRoutes = true,
  showCoverage,
  className = '',
  listedIn,
}: {
  points: MapPoint[];
  /** Fibre routes between nodes on the register. */
  routes?: MapRoute[];
  showRoutes?: boolean;
  showCoverage: boolean;
  className?: string;
  /** Where the same points can be read as text, named so the summary can send a reader there. */
  listedIn?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  // Memoised: `showRoutes ? routes : []` builds a new array on every render, which would make the
  // redraw effect below fire on every render and drop the reader's pan and zoom as it went.
  const drawnRoutes = useMemo(() => (showRoutes ? routes : []), [showRoutes, routes]);
  const summary = useMemo(
    () => describeMap(points, listedIn, drawnRoutes),
    [points, listedIn, drawnRoutes],
  );
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

    /*
     * Routes first, so a pin is never buried under a line it ends at.
     *
     * A surveyed route is drawn solid; one that is only the straight line between two nodes is
     * drawn dashed and says so when opened. They are the same colour because they are the same
     * layer, and the difference is real: the dashed one is where the cable goes in principle, and
     * nobody should read it off the map as where to dig.
     */
    for (const route of drawnRoutes) {
      L.polyline(route.path, {
        color: ROUTE_COLOUR,
        weight: route.surveyed ? 3 : 2,
        opacity: route.surveyed ? 0.85 : 0.5,
        dashArray: route.surveyed ? undefined : '6 6',
        // A class of its own. Coverage rings and pins are SVG paths in the same pane, so without
        // it there is no way to ask the map how many routes it drew.
        className: 'nca-fibre-route',
      })
        .bindPopup(
          `<strong>${escapeHtml(route.name)}</strong><br>` +
            `${escapeHtml(route.from)} to ${escapeHtml(route.to)}<br>` +
            (route.lengthKm === null
              ? ''
              : `${escapeHtml(String(route.lengthKm))} km of fibre<br>`) +
            (route.capacityGbps === null
              ? ''
              : `${escapeHtml(String(route.capacityGbps))} Gbit/s<br>`) +
            `<span style="color:#6b7280">${escapeHtml(route.entity.name)}</span>` +
            (route.surveyed
              ? ''
              : '<br><span style="color:#b45309">Straight line between the two nodes. ' +
                'The surveyed route has not been supplied.</span>'),
        )
        .addTo(layer);
    }

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
    // Routes count: a map filtered down to routes alone would otherwise open over the Atlantic.
    const framed: [number, number][] = [
      ...points.map((p) => [p.lat, p.lng] as [number, number]),
      ...drawnRoutes.flatMap((r) => r.path),
    ];
    if (framed.length > 0) {
      map.fitBounds(L.latLngBounds(framed), { padding: [40, 40], maxZoom: 13 });
    }
  }, [points, drawnRoutes, showCoverage]);

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
