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
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MlMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  StyleSpecification,
  VectorTileSource,
} from 'maplibre-gl';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { BASEMAPS, type BasemapId } from '~/lib/basemaps';
import { compact } from '~/lib/format';
import {
  $gbifStale,
  countRequest,
  isEdgeUrl,
  markEdgeDown,
  occurrenceTileTemplate,
  onEdgeChange,
  polygonToWkt,
  searchOccurrences,
  type TileFilter,
} from '~/lib/gbif';
import { circleRing } from '~/lib/gbif/params';
import { MAX_ZOOM_STOP, rampColors, thresholdsAt } from '~/lib/ramp';
import { $nearAt, $nearRadius, setNearLocation } from '~/stores/near';
import {
  $basemap,
  $flyTo,
  $hexGeometry,
  $mapBounds,
  $mapMode,
  $mapView,
  $occurrenceFilter,
  $selectedHex,
  $selectedRecord,
  $showRecords,
  $tileFilter,
  $panel,
  clearHexSelection,
  type FlyRequest,
  type HexGeometry,
} from '~/stores/explorer';

const HEX_PER_TILE = 28;
const OCC_LAYERS = ['occ-fill'];
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Glyphs for our own labels (cluster counts), also used on raster basemaps. */
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Bold'];

const container = ref<HTMLDivElement>();
const loading = ref(true);
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
  return [occurrenceTileTemplate(f, { hexPerTile: HEX_PER_TILE }, 'mvt')];
}

/** Zoom-interpolated log bins (see lib/ramp.ts); matches the legend. */
function fillColor(): ExpressionSpecification {
  const c = rampColors();
  const stops: unknown[] = [];
  for (let z = 0; z <= MAX_ZOOM_STOP; z++) {
    const step: unknown[] = ['step', ['get', 'total'], c[0]];
    thresholdsAt(z).forEach((t, i) => step.push(t, c[i + 1]));
    stops.push(z, step);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
}

const styleCache = new Map<string, Promise<StyleSpecification | null>>();

/** Fetch (once) a vector basemap style; null if it cannot be loaded. */
function fetchStyle(url: string): Promise<StyleSpecification | null> {
  let p = styleCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : null))
      .catch(() => null);
    styleCache.set(url, p);
  }
  return p;
}

/** Our data sources and layers, shared by every basemap. */
function overlay(): {
  sources: StyleSpecification['sources'];
  data: LayerSpecification[];
  top: LayerSpecification[];
} {
  const accent = css('--accent', '#f0b443');
  const bg = css('--bg', '#0e1813');
  const text = css('--text', '#e9f0ea');
  const occ = {
    type: 'vector' as const,
    tiles: occTiles($tileFilter.get()),
    maxzoom: 14,
    attribution: 'Occurrence data © <a href="https://www.gbif.org">GBIF.org</a> and data publishers',
  };
  return {
    sources: {
      occ,
      hover: { type: 'geojson', data: EMPTY },
      selected: { type: 'geojson', data: selectedGeoJson($hexGeometry.get()) },
      records: { type: 'geojson', data: lastRecords, cluster: true, clusterRadius: 40, clusterMaxZoom: 14 },
      near: { type: 'geojson', data: nearGeoJson() },
    },
    // Drawn below basemap labels.
    data: [
      {
        id: 'occ-fill',
        type: 'fill',
        source: 'occ',
        'source-layer': 'occurrence',
        paint: {
          'fill-color': fillColor(),
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.78, 8, 0.66],
          'fill-antialias': true,
        },
      },
    ],
    // Drawn above everything.
    top: [
      { id: 'hover-line', type: 'line', source: 'hover', paint: { 'line-color': text, 'line-width': 1.5 } },
      { id: 'selected-line', type: 'line', source: 'selected', paint: { 'line-color': accent, 'line-width': 3 } },
      {
        id: 'near-area',
        type: 'fill',
        source: 'near',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': accent, 'fill-opacity': 0.08 },
      },
      {
        id: 'near-edge',
        type: 'line',
        source: 'near',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'near-pin',
        type: 'circle',
        source: 'near',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': accent, 'circle-radius': 7, 'circle-stroke-color': bg, 'circle-stroke-width': 3 },
      },
      {
        id: 'record-clusters',
        type: 'circle',
        source: 'records',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': accent,
          'circle-opacity': 0.9,
          'circle-stroke-color': bg,
          'circle-stroke-width': 2,
          'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 22],
        },
      },
      {
        id: 'record-count',
        type: 'symbol',
        source: 'records',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': 12 },
        paint: { 'text-color': css('--accent-contrast', '#1d1404') },
      },
      {
        id: 'record-points',
        type: 'circle',
        source: 'records',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': accent, 'circle-radius': 6, 'circle-stroke-color': bg, 'circle-stroke-width': 2 },
      },
    ],
  };
}

async function buildStyle(basemap: BasemapId): Promise<StyleSpecification> {
  const t = theme();
  const bg = css('--bg', '#0e1813');
  const src = BASEMAPS[basemap].source(t);
  const ours = overlay();
  const globe: Pick<StyleSpecification, 'projection' | 'sky'> = {
    projection: { type: 'globe' },
    sky: {
      'sky-color': bg,
      'horizon-color': bg,
      'fog-color': bg,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 0.2, 7, 0],
    },
  };

  const base = src.kind === 'vector' ? await fetchStyle(src.styleUrl) : null;
  if (base) {
    // Insert the data below the first label layer so place names stay legible.
    const firstSymbol = base.layers.findIndex((l) => l.type === 'symbol');
    const cut = firstSymbol === -1 ? base.layers.length : firstSymbol;
    const text = css('--text', '#e9f0ea');
    const layers = base.layers.map((l): LayerSpecification => {
      if (l.type === 'background') return { ...l, paint: { ...l.paint, 'background-color': bg } };
      // Roads and rivers show through the semi-transparent hexes; keep them for close zooms.
      if (l.type === 'line' && /waterway|highway|road|railway|aeroway/.test(l.id)) {
        return { ...l, minzoom: Math.max(l.minzoom ?? 0, 8) };
      }
      // Labels sit on top of the data, so give them theme colours and a halo.
      if (l.type === 'symbol') {
        // Keep the data readable: only country/continent names below z5.
        const major = /country|continent/.test(l.id);
        return {
          ...l,
          ...(!major && { minzoom: Math.max(l.minzoom ?? 0, 5) }),
          paint: { ...l.paint, 'text-color': text, 'text-halo-color': bg, 'text-halo-width': 1.4, 'text-opacity': 0.9 },
        };
      }
      return l;
    });
    return {
      ...base,
      ...globe,
      sources: { ...base.sources, ...ours.sources },
      layers: [...layers.slice(0, cut), ...ours.data, ...layers.slice(cut), ...ours.top],
    };
  }

  // Raster basemap (or vector style unavailable: plain background).
  const raster = src.kind === 'raster' ? src : null;
  return {
    version: 8,
    glyphs: GLYPHS,
    ...globe,
    sources: {
      ...(raster && {
        base: {
          type: 'raster',
          tiles: raster.tiles,
          tileSize: raster.tileSize,
          maxzoom: raster.maxzoom,
          attribution: raster.attribution,
        },
      }),
      ...ours.sources,
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': bg } },
      ...(raster ? [{ id: 'base', type: 'raster' as const, source: 'base', paint: { 'raster-opacity': 0.9 } }] : []),
      ...ours.data,
      ...ours.top,
    ],
  };
}

/** Pin + radius circle for "near me" (only while the map is in pin mode). */
function nearGeoJson(): GeoJSON.FeatureCollection {
  const at = $nearAt.get();
  if ($mapMode.get() !== 'pin' || !at) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circleRing(at.lat, at.lng, $nearRadius.get())] },
      },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [at.lng, at.lat] } },
    ],
  };
}

function selectedGeoJson(g: HexGeometry | null): GeoJSON.FeatureCollection {
  if (!g) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [g.ring] } }],
  };
}

/** Pick the most informative hex under a point (edge cells can be split across tiles). */
function hexAt(point: { x: number; y: number }): MapGeoJSONFeature | undefined {
  if (!map) return undefined;
  const feats = map.queryRenderedFeatures([point.x, point.y], { layers: OCC_LAYERS });
  return feats.sort((a, b) => Number(b.properties['total'] ?? 0) - Number(a.properties['total'] ?? 0))[0];
}

function geometryOf(f: MapGeoJSONFeature): HexGeometry | null {
  const g = f.geometry;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : undefined;
  if (!ring || ring.length < 4) return null;
  const r = ring.map((p) => [p[0] as number, p[1] as number] as [number, number]);
  return { ring: r, wkt: polygonToWkt(r), tileTotal: Number(f.properties['total'] ?? 0) };
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
    (map?.getSource('records') as GeoJSONSource | undefined)?.setData(EMPTY);
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
  (map.getSource('records') as GeoJSONSource | undefined)?.setData(lastRecords);
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

function onMove(e: MapMouseEvent) {
  const f = hexAt(e.point);
  const hover = map?.getSource('hover') as GeoJSONSource | undefined;
  if (!f) {
    hover?.setData(EMPTY);
    tooltip.value = null;
    map!.getCanvas().style.cursor = '';
    return;
  }
  hover?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: f.geometry }] });
  const total = Number(f.properties['total'] ?? 0);
  tooltip.value = { x: e.point.x, y: e.point.y, text: `${compact(total)} record${total === 1 ? '' : 's'}` };
  map!.getCanvas().style.cursor = 'pointer';
}

function onClick(e: MapMouseEvent) {
  if (!map) return;
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

function sameView(a: { lng: number; lat: number; zoom: number }, b: { lng: number; lat: number; zoom: number }) {
  return (
    a.lng.toFixed(2) === b.lng.toFixed(2) &&
    a.lat.toFixed(2) === b.lat.toFixed(2) &&
    a.zoom.toFixed(1) === b.zoom.toFixed(1)
  );
}

let styleSeq = 0;
async function rebuildStyle() {
  if (!map) return;
  const mine = ++styleSeq;
  const style = await buildStyle($basemap.get());
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
  if (!container.value) return;
  const v = $mapView.get();
  const style = await buildStyle($basemap.get());
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
    (map?.getSource('hover') as GeoJSONSource | undefined)?.setData(EMPTY);
  });
  map.on('click', onClick);
  map.on('dataloading', () => (loading.value = true));
  map.on('idle', () => {
    loading.value = false;
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
    $tileFilter.listen((f) => (map?.getSource('occ') as VectorTileSource | undefined)?.setTiles(occTiles(f))),
    // Edge went down or came back: re-point the tile source.
    onEdgeChange(() => (map?.getSource('occ') as VectorTileSource | undefined)?.setTiles(occTiles($tileFilter.get()))),
    $basemap.listen(() => void rebuildStyle()),
    $mapView.listen((v) => {
      if (!map) return;
      const c = map.getCenter();
      if (!sameView(v, { lng: c.lng, lat: c.lat, zoom: map.getZoom() }))
        map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
    }),
    $hexGeometry.subscribe((g) => {
      (map?.getSource('selected') as GeoJSONSource | undefined)?.setData(selectedGeoJson(g));
      void loadRecords();
    }),
    $selectedHex.listen((p) => {
      if (!p) $hexGeometry.set(null);
      else if (!$hexGeometry.get()) pendingHexRestore = true;
    }),
    $showRecords.listen(() => void loadRecords()),
    ...[$nearAt, $nearRadius, $mapMode].map((s) =>
      s.listen(() => (map?.getSource('near') as GeoJSONSource | undefined)?.setData(nearGeoJson())),
    ),
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
    <div v-if="loading" class="map-progress" role="status" aria-label="Loading map data"></div>
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
.map-progress {
  position: absolute;
  inset: var(--header-offset) 0 auto 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: sweep 1.2s var(--ease) infinite;
  z-index: 5;
}

@keyframes sweep {
  from {
    background-position: -40% 0;
  }
  to {
    background-position: 140% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-progress {
    animation: none;
    background: var(--accent);
    opacity: 0.5;
  }
}

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
