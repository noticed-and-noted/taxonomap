<script setup lang="ts">
/**
 * The persisted map island (client:only). MapLibre with a globe at low zoom,
 * a basemap, and GBIF hex-density vector tiles styled client-side so the
 * legend matches exactly and cells can be queried on click.
 *
 * All state flows through Nano Stores (URL-synced), so other islands
 * (overlay, omnibox, panel) drive it without importing it.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  GeoJSONSource,
  Map as MlMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  Point,
  VectorTileSource,
} from 'maplibre-gl';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { compact } from '~/lib/format';
import {
  $gbifStale,
  countRequest,
  isEdgeUrl,
  markEdgeDown,
  occurrenceTileTemplate,
  onEdgeChange,
  searchOccurrences,
  type TileFilter,
} from '~/lib/gbif';
import {
  buildStyle,
  EMPTY,
  fillColor,
  geometryOf,
  nearGeoJson,
  OCC_LAYERS,
  selectedGeoJson,
  type MapColors,
} from '~/lib/map/style';
import { convexOverlap, hullRing, mercatorPx, outerRings, type Pt } from '~/lib/map/hexPieces';
import { loadPolarTile, POLAR_SCHEMES, viaPolar } from '~/lib/map/polarTiles';
import { createTileProgress, type TileLike } from '~/lib/map/tileProgress';
import { $nearAt, $nearRadius, setNearLocation } from '~/stores/near';
import { $ramp } from '~/stores/ramp';
import { PIN_CURSOR } from './pinCursors';
import {
  $basemap,
  $flyTo,
  $hexGeometry,
  $mapBounds,
  $mapLoad,
  $mapMode,
  $mapView,
  $occurrenceFilter,
  $selectedHex,
  $selectedRecord,
  $showRecords,
  $panel,
  clearHexSelection,
  sameView,
  type FlyRequest,
} from '~/stores/explorer';

const HEX_PER_TILE = 28;

const container = ref<HTMLDivElement>();
const tiles = createTileProgress();
const failed = ref(false);
const tooltip = ref<{ x: number; y: number; text: string } | null>(null);

let map: MlMap | undefined;
const cleanups: (() => void)[] = [];
let lastRecords: GeoJSON.FeatureCollection = EMPTY;
let pendingHexRestore = false;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const theme = (): 'dark' | 'light' => (document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark');
const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function occTiles(f: TileFilter): string[] {
  return [viaPolar(occurrenceTileTemplate(f, { hexPerTile: HEX_PER_TILE }, 'mvt'))];
}

/** Theme colours from the CSS custom properties (fallbacks match the dark theme). */
function colors(): MapColors {
  return {
    accent: css('--accent', '#f0b443'),
    accentContrast: css('--accent-contrast', '#1d1404'),
    bg: css('--bg', '#0e1813'),
    text: css('--text', '#f2ede2'),
  };
}

/** The "near me" pin and circle, shown only while the map is in pin mode. */
const nearData = () => nearGeoJson($mapMode.get() === 'pin' ? $nearAt.get() : null, $nearRadius.get());

/** Replace a GeoJSON source's data, if the style has that source yet. */
function setData(source: string, data: GeoJSON.GeoJSON) {
  (map?.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** Point the occurrence source at new tile URLs (filters changed, or the edge cache went down). */
const setOccTiles = () =>
  (map?.getSource('occ') as VectorTileSource | undefined)?.setTiles(occTiles($occurrenceFilter.get()));

/**
 * Push the current overlay data into a freshly loaded style. A style is built
 * from the stores, then loads asynchronously; a store change in between (near
 * me switching to pin mode on a reload, say) finds no source and would be lost.
 */
function syncOverlays() {
  setData('selected', selectedGeoJson($hexGeometry.get()));
  setData('records', lastRecords);
  setData('near', nearData());
}

function styleFor() {
  return buildStyle($basemap.get(), theme(), colors(), {
    tiles: occTiles($occurrenceFilter.get()),
    selected: selectedGeoJson($hexGeometry.get()),
    records: lastRecords,
    near: nearData(),
  });
}

type Cell = Pick<MapGeoJSONFeature, 'geometry' | 'properties'>;

/**
 * The hex under a point, whole. Pick the most informative piece there (edge
 * cells can be split across tiles), then grow it with every rendered piece
 * that overlaps it: past the source maxzoom each overzoomed tile holds only
 * its own slice of the cell.
 */
function hexAt(point: { x: number; y: number }): Cell | undefined {
  if (!map) return undefined;
  const m = map;
  const feats = m.queryRenderedFeatures([point.x, point.y], { layers: OCC_LAYERS });
  const seed = feats.sort((a, b) => Number(b.properties['total'] ?? 0) - Number(a.properties['total'] ?? 0))[0];
  if (!seed) return undefined;
  // Overlap and hull are worked in flat Web Mercator, where cells are convex and
  // tile slices axis-aligned. On the globe's screen, edges curve and the
  // antimeridian folds the world, so unrelated pieces can seem to overlap.
  const zoom = m.getZoom();
  const toPx = (p: Pt) => mercatorPx(p, zoom);
  const pieces = outerRings(seed.geometry);
  const px = pieces.map((r) => r.map(toPx));
  const seen = new Set(pieces.map((r) => JSON.stringify(r)));
  for (let grew = true; grew;) {
    grew = false;
    const screen = pieces.flat().map((p) => m.project(p));
    const xs = screen.map((p) => p.x);
    const ys = screen.map((p) => p.y);
    const box: [[number, number], [number, number]] = [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ];
    for (const f of m.queryRenderedFeatures(box, { layers: OCC_LAYERS })) {
      for (const ring of outerRings(f.geometry)) {
        const key = JSON.stringify(ring);
        if (seen.has(key)) continue;
        const ringPx = ring.map(toPx);
        if (!px.some((p) => convexOverlap(p, ringPx))) continue;
        seen.add(key);
        pieces.push(ring);
        px.push(ringPx);
        grew = true;
      }
    }
  }
  if (pieces.length === 1) return seed;
  return { properties: seed.properties, geometry: { type: 'Polygon', coordinates: [hullRing(pieces, toPx)] } };
}

function selectAt(point: { x: number; y: number }, lngLat: { lng: number; lat: number }) {
  const f = hexAt(point);
  const geom = f && geometryOf(f);
  if (!geom) {
    clearHexSelection();
    return;
  }
  $selectedRecord.set(null);
  $showRecords.set(false);
  $hexGeometry.set(geom);
  $selectedHex.set([Number(lngLat.lng.toFixed(4)), Number(lngLat.lat.toFixed(4))]);
  $panel.set('hex');
}

/** Re-resolve a hex selected via the URL once tiles are rendered. */
function restoreHex() {
  const p = $selectedHex.get();
  if (!map || !p || $hexGeometry.get()) {
    pendingHexRestore = false;
    return;
  }
  const pt = map.project(p as [number, number]);
  const f = hexAt(pt);
  const geom = f && geometryOf(f);
  if (geom) {
    $hexGeometry.set(geom);
    if ($panel.get() === 'none') $panel.set('hex');
  }
  pendingHexRestore = false;
}

async function loadRecords() {
  const geom = $hexGeometry.get();
  if (!map || !$showRecords.get() || !geom) {
    lastRecords = EMPTY;
    setData('records', EMPTY);
    return;
  }
  try {
    const res = await searchOccurrences(
      { ...$occurrenceFilter.get(), geometry: geom.wkt, georeferenced: true },
      { limit: 300 },
    );
    lastRecords = {
      type: 'FeatureCollection',
      features: res.results
        .filter((r) => r.decimalLatitude !== undefined && r.decimalLongitude !== undefined)
        .map((r) => ({
          type: 'Feature',
          properties: { key: r.key },
          geometry: { type: 'Point', coordinates: [r.decimalLongitude as number, r.decimalLatitude as number] },
        })),
    };
  } catch {
    lastRecords = EMPTY;
  }
  setData('records', lastRecords);
}

function fly(req: FlyRequest) {
  if (!map) return;
  const animate = !reducedMotion();
  if (req.kind === 'bounds') {
    const [w, s, e, n] = req.bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 60, maxZoom: req.maxZoom ?? 9, duration: animate ? 1200 : 0 },
    );
  } else {
    map.flyTo({ center: [req.lng, req.lat], zoom: req.zoom, duration: animate ? 1400 : 0, essential: false });
  }
}

/**
 * Whether a screen point misses the globe (space around it at low zoom).
 * Tiles still answer queries there, as if the point were on the planet. Off
 * the globe, unproject snaps to the horizon, so the point does not round-trip.
 */
function offGlobe(p: Point): boolean {
  if (!map) return true;
  const back = map.project(map.unproject(p));
  return Math.hypot(back.x - p.x, back.y - p.y) > 1;
}

function onMove(e: MapMouseEvent) {
  // Pin mode: no cell hover, the cursor says a click drops the pin.
  if ($mapMode.get() === 'pin') return;
  const f = offGlobe(e.point) ? undefined : hexAt(e.point);
  if (!f) {
    setData('hover', EMPTY);
    tooltip.value = null;
    map!.getCanvas().style.cursor = '';
    return;
  }
  setData('hover', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: f.geometry }],
  });
  const total = Number(f.properties['total'] ?? 0);
  tooltip.value = { x: e.point.x, y: e.point.y, text: `${compact(total)} record${total === 1 ? '' : 's'}` };
  map!.getCanvas().style.cursor = 'pointer';
}

function onClick(e: MapMouseEvent) {
  if (!map || offGlobe(e.point)) return;
  if ($mapMode.get() === 'pin') {
    setNearLocation(e.lngLat.lat, e.lngLat.lng);
    return;
  }
  const cluster = map.queryRenderedFeatures(e.point, { layers: ['record-clusters'] })[0];
  if (cluster) {
    const src = map.getSource('records') as GeoJSONSource;
    void src.getClusterExpansionZoom(Number(cluster.properties['cluster_id'])).then((zoom) => {
      const [lng, lat] = (cluster.geometry as GeoJSON.Point).coordinates as [number, number];
      map?.easeTo({ center: [lng, lat], zoom, duration: reducedMotion() ? 0 : 400 });
    });
    return;
  }
  const point = map.queryRenderedFeatures(e.point, { layers: ['record-points'] })[0];
  if (point) {
    $selectedRecord.set(Number(point.properties['key']));
    $panel.set('hex');
    return;
  }
  selectAt(e.point, e.lngLat);
}

function onKey(e: KeyboardEvent) {
  if (!map) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const c = map.getCanvas();
    const point = { x: c.clientWidth / 2, y: c.clientHeight / 2 };
    const ll = map.unproject([point.x, point.y]);
    if ($mapMode.get() === 'pin') setNearLocation(ll.lat, ll.lng);
    else selectAt(point, ll);
  } else if (e.key === 'Escape') {
    clearHexSelection();
  }
}

let styleSeq = 0;
async function rebuildStyle() {
  if (!map) return;
  const mine = ++styleSeq;
  const style = await styleFor();
  if (map && mine === styleSeq) map.setStyle(style, { diff: false });
}

onMounted(async () => {
  const [ml, worker] = await Promise.all([
    import('maplibre-gl'),
    // MapLibre derives its worker URL from import.meta.url, which breaks once
    // bundled; ship the self-contained worker as an asset instead.
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
  ]);
  ml.setWorkerUrl(worker.default);
  for (const scheme of POLAR_SCHEMES) ml.addProtocol(scheme, loadPolarTile);
  if (!container.value) return;
  const v = $mapView.get();
  const style = await styleFor();
  if (!container.value) return;
  map = new ml.Map({
    container: container.value,
    style,
    center: [v.lng, v.lat],
    zoom: v.zoom,
    attributionControl: { compact: true },
    maxPitch: 0,
    dragRotate: false,
    renderWorldCopies: false,
    fadeDuration: reducedMotion() ? 0 : 200,
    // Called on the main thread for every request, including worker-loaded tiles.
    transformRequest: (url, type) => {
      if (type === 'Tile' && url.includes('/v2/map/occurrence/')) countRequest('tile', url);
      return { url };
    },
  });
  map.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-right');
  if (import.meta.env.DEV) (window as unknown as { __map?: MlMap }).__map = map;
  // Track container size (window resize alone misses layout changes).
  const ro = new ResizeObserver(() => map?.resize());
  ro.observe(container.value);
  cleanups.push(() => ro.disconnect());
  map.touchZoomRotate.disableRotation();
  map
    .getCanvas()
    .setAttribute(
      'aria-label',
      'Map of occurrence records. Use arrow keys to pan, plus and minus to zoom, Enter to select the cell under the crosshair, Escape to clear.',
    );

  // Visible extent from the canvas corners (getBounds() is world-wide under
  // the globe projection). At very low zoom, corners miss the globe: world.
  const publishBounds = () => {
    if (!map) return;
    const c = map.getCanvas();
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (map.getZoom() < 2.5 || !w || !h) {
      $mapBounds.set([-180, -85, 180, 85]);
      return;
    }
    const pts = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
      [w / 2, 0],
      [w / 2, h],
    ].map(([x, y]) => map!.unproject([x as number, y as number]));
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    $mapBounds.set([
      Math.min(...lngs),
      Math.max(-85, Math.min(...lats)),
      Math.max(...lngs),
      Math.min(85, Math.max(...lats)),
    ]);
  };
  map.once('load', publishBounds);
  map.on('moveend', () => {
    if (!map) return;
    publishBounds();
    const c = map.getCenter();
    const next = { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
    if (!sameView(next, $mapView.get())) $mapView.set(next);
  });
  map.on('mousemove', onMove);
  map.on('mouseout', () => {
    tooltip.value = null;
    setData('hover', EMPTY);
  });
  map.on('click', onClick);
  // Tile progress for the loading ring (MapProgress): count each tile in the burst as it starts and settles.
  // Loading means tiles are still pending, not "until idle" (idle also waits for fades and repaints).
  // Only tile events start a burst: GeoJSON setData (hover, selection) also fires `dataloading`.
  const publishLoad = () => {
    const p = tiles.get();
    // Before the first tile (style still loading) keep the initial state.
    $mapLoad.set({ loading: p.total ? p.done < p.total : $mapLoad.get().loading, ...p });
  };
  const onTile = (start: boolean) => (e: object) => {
    const { tile } = e as { tile?: TileLike };
    if (start) {
      if (!tile) return;
      // A new burst: the last one's counts were kept for the ring's fade-out.
      if (!$mapLoad.get().loading) tiles.reset();
      tiles.start(tile);
    } else tiles.settle(tile);
    publishLoad();
  };
  map.on('dataloading', onTile(true));
  map.on('data', onTile(false));
  map.on('dataabort', onTile(false));
  map.on('error', onTile(false));
  map.on('style.load', syncOverlays);
  map.on('idle', () => {
    // Anything still pending settled silently (a 404); the burst is over either way.
    tiles.settle();
    $mapLoad.set({ ...tiles.get(), loading: false });
    if (pendingHexRestore || ($selectedHex.get() && !$hexGeometry.get())) restoreHex();
  });
  map.on('error', (e) => {
    // Tile failures: keep the map usable and show the quiet stale note.
    const err = e.error as { status?: number; url?: string } | undefined;
    const status = err?.status;
    // Edge cache failing (quota, outage, CORS-less error page): go straight to GBIF.
    if (err?.url && isEdgeUrl(err.url) && (!status || status === 429 || status >= 500)) {
      markEdgeDown();
      return;
    }
    if (status === 429 || (status !== undefined && status >= 500)) $gbifStale.set(true);
    if ((e as { sourceId?: string }).sourceId === 'occ' && status === undefined) failed.value = true;
  });
  map.getCanvas().addEventListener('keydown', onKey);
  cleanups.push(() => map?.getCanvas().removeEventListener('keydown', onKey));

  // Store → map
  cleanups.push(
    $occurrenceFilter.listen(setOccTiles),
    // Edge went down or came back: re-point the tile source.
    onEdgeChange(setOccTiles),
    $basemap.listen(() => void rebuildStyle()),
    // A new density ramp only repaints the hexes.
    $ramp.listen(() => {
      if (map?.getLayer('occ-fill')) map.setPaintProperty('occ-fill', 'fill-color', fillColor());
    }),
    $mapView.listen((v) => {
      if (!map) return;
      const c = map.getCenter();
      if (!sameView(v, { lng: c.lng, lat: c.lat, zoom: map.getZoom() }))
        map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
    }),
    $hexGeometry.subscribe((g) => {
      setData('selected', selectedGeoJson(g));
      void loadRecords();
    }),
    $selectedHex.listen((p) => {
      if (!p) $hexGeometry.set(null);
      else if (!$hexGeometry.get()) pendingHexRestore = true;
    }),
    $showRecords.listen(() => void loadRecords()),
    $mapMode.subscribe((mode) => {
      if (!map) return;
      tooltip.value = null;
      setData('hover', EMPTY);
      map.getCanvas().style.cursor = mode === 'pin' ? PIN_CURSOR : '';
    }),
    ...[$nearAt, $nearRadius, $mapMode].map((s) => s.listen(() => setData('near', nearData()))),
    $occurrenceFilter.listen(() => void loadRecords()),
    $flyTo.subscribe((req) => {
      if (!req) return;
      fly(req);
      $flyTo.set(null);
    }),
  );

  // Theme switch: the plain basemap and accent colours follow it.
  const observer = new MutationObserver(() => void rebuildStyle());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => observer.disconnect());

  // The map is persisted across ClientRouter swaps; size may have changed.
  const onSwap = () => requestAnimationFrame(() => map?.resize());
  document.addEventListener('astro:after-swap', onSwap);
  cleanups.push(() => document.removeEventListener('astro:after-swap', onSwap));
});

onBeforeUnmount(() => {
  cleanups.forEach((fn) => fn());
  map?.remove();
  map = undefined;
});
</script>

<template>
  <div class="map-canvas relative size-full" data-testid="map">
    <div ref="container" class="size-full" role="region" aria-label="Occurrence map"></div>
    <div class="crosshair" aria-hidden="true"></div>
    <div
      v-if="tooltip"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] rounded-sm bg-surface px-2 py-1 text-xs text-text shadow-panel"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      {{ tooltip.text }}
    </div>
    <p
      v-if="failed"
      class="absolute left-1/2 top-[calc(var(--header-offset)+0.75rem)] -translate-x-1/2 rounded-md bg-surface px-3 py-2 text-xs text-muted shadow-panel"
    >
      Occurrence tiles are unavailable right now. The basemap still works.
    </p>
  </div>
</template>

<style scoped>
/* Crosshair appears only while the map has keyboard focus. */
.crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease);
}

.map-canvas:has(canvas:focus-visible) .crosshair {
  opacity: 1;
}
</style>

<style>
/* MapLibre's own DOM (controls, attribution), so unscoped. */
.map-canvas .maplibregl-ctrl-group {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.map-canvas .maplibregl-ctrl-group button + button {
  border-top-color: var(--border);
}

:root:not([data-theme='light']) .map-canvas .maplibregl-ctrl-icon {
  filter: invert(1) hue-rotate(180deg);
}

.map-canvas .maplibregl-ctrl-attrib {
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--text-muted);
}

.map-canvas .maplibregl-ctrl-attrib a {
  color: var(--text);
}

.map-canvas canvas:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
