<script setup lang="ts">
/**
 * The persisted map island (client:only). MapLibre with a globe at low zoom,
 * a basemap, and GBIF hex-density cells (occLayer) styled client-side so the
 * legend matches exactly and cells can be queried on click.
 *
 * All state flows through Nano Stores (URL-synced), so other islands
 * (overlay, omnibox, panel) drive it without importing it.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { compact, full } from '~/lib/format';
import { searchOccurrences } from '~/lib/gbif';
import {
  buildStyle,
  EMPTY,
  fillColor,
  geometryOf,
  nearGeoJson,
  occOpacity,
  selectedGeoJson,
  type MapColors,
} from '~/lib/map/style';
import { createHoverCounter, knownCount } from '~/lib/map/cellCounts';
import type { Hex } from '~/lib/map/occGrid';
import { createOccLayer, type OccLayer } from '~/lib/map/occLayer';
import { $nearAt, $nearRadius, setNearLocation } from '~/stores/near';
import { $ramp } from '~/stores/ramp';
import { PIN_CURSOR } from './pinCursors';
import {
  $basemap,
  $flyTo,
  $gridLevel,
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

const container = ref<HTMLDivElement>();
const failed = ref(false);
const tooltip = ref<{ x: number; y: number; text: string; wkt: string } | null>(null);

let map: MlMap | undefined;
let occ: OccLayer | undefined;
const cleanups: (() => void)[] = [];
let lastRecords: GeoJSON.FeatureCollection = EMPTY;
let pendingHexRestore = false;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const theme = (): 'dark' | 'light' => (document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark');
const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

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

/** Colour both hex layers with the bins for this grid level. */
function paintHexes(level = $gridLevel.get()) {
  for (const id of ['occ-fill', 'occ-fresh-fill']) {
    if (map?.getLayer(id)) map.setPaintProperty(id, 'fill-color', fillColor(level));
  }
}

/** How long arriving cells take to fade in. */
const FADE_MS = 180;
/** Cells fading in on `occ-fresh`, and the fade they belong to. */
let fresh: Hex[] = [];
let fade = 0;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/** Move cells that have faded in onto `occ`. */
function settleFresh() {
  clearTimeout(fadeTimer);
  if (!fresh.length) return;
  const mine = fade;
  const src = map?.getSource('occ') as GeoJSONSource | undefined;
  void src?.updateData({ add: fresh }).then(() => {
    // A newer fade may have started meanwhile; its cells stay.
    if (mine === fade) setData('occ-fresh', EMPTY);
  });
  fresh = [];
}

/** Cells arriving as you pan: removed ones go at once, new ones fade in. */
function changeHexes(add: Hex[], remove: string[]) {
  settleFresh();
  const src = map?.getSource('occ') as GeoJSONSource | undefined;
  if (!map || !src) return;
  if (remove.length) void src.updateData({ remove });
  if (!add.length) return;
  if (reducedMotion()) {
    void src.updateData({ add });
    return;
  }
  const m = map;
  fresh = add;
  fade++;
  setData('occ-fresh', { type: 'FeatureCollection', features: add });
  m.setPaintProperty('occ-fresh-fill', 'fill-opacity-transition', { duration: 0, delay: 0 });
  m.setPaintProperty('occ-fresh-fill', 'fill-opacity', 0);
  requestAnimationFrame(() => {
    m.setPaintProperty('occ-fresh-fill', 'fill-opacity-transition', { duration: FADE_MS, delay: 0 });
    m.setPaintProperty('occ-fresh-fill', 'fill-opacity', occOpacity(m.getZoom()));
  });
  fadeTimer = setTimeout(settleFresh, FADE_MS + 20);
}

/** A whole new set of cells (new level or filters): no fade, nothing left mid-fade. */
function replaceHexes(fc: GeoJSON.FeatureCollection) {
  clearTimeout(fadeTimer);
  fresh = [];
  fade++;
  setData('occ-fresh', EMPTY);
  setData('occ', fc);
}

/**
 * Push the current overlay data into a freshly loaded style. A style is built
 * from the stores, then loads asynchronously; a store change in between (near
 * me switching to pin mode on a reload, say) finds no source and would be lost.
 */
function syncOverlays() {
  replaceHexes(occ?.collection() ?? EMPTY);
  // The grid level is set as the map starts, usually before its style has loaded.
  paintHexes();
  setData('selected', selectedGeoJson($hexGeometry.get()));
  setData('records', lastRecords);
  setData('near', nearData());
}

function styleFor() {
  return buildStyle($basemap.get(), theme(), colors(), {
    hexes: occ?.collection() ?? EMPTY,
    level: $gridLevel.get(),
    selected: selectedGeoJson($hexGeometry.get()),
    records: lastRecords,
    near: nearData(),
  });
}

/**
 * Whether a screen point misses the globe (space around it at low zoom).
 * There, unproject snaps to the horizon, so the point does not round-trip.
 */
function offGlobe(p: { x: number; y: number }): boolean {
  if (!map) return true;
  const back = map.project(map.unproject([p.x, p.y]));
  return Math.hypot(back.x - p.x, back.y - p.y) > 1;
}

/** The hex cell under a screen point, if any. */
function hexAt(point: { x: number; y: number }): Hex | undefined {
  if (!map || !occ || offGlobe(point)) return undefined;
  const ll = map.unproject([point.x, point.y]);
  return occ.cellAt([ll.lng, ll.lat]);
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

/** Re-resolve a hex selected via the URL once its cell is loaded. */
function restoreHex() {
  const p = $selectedHex.get();
  if (!occ || !p || $hexGeometry.get()) {
    pendingHexRestore = false;
    return;
  }
  const f = occ.cellAt([p[0], p[1]]);
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

/** How much of the map the floating header, bottom sheet and side panel cover, in px per edge. */
function coveredEdges() {
  const box = map!.getContainer().getBoundingClientRect();
  const header = document.querySelector('.app-header')?.getBoundingClientRect();
  // offsetHeight, not the rect: the sheet may still be sliding in.
  const sheet = document.querySelector<HTMLElement>('.bottom-sheet')?.offsetHeight ?? 0;
  const panel = document.querySelector('.side-panel:not(.collapsed)')?.getBoundingClientRect();
  return {
    top: header ? Math.max(0, header.bottom - box.top) : 0,
    bottom: Math.min(sheet, box.height / 2),
    left: 0,
    right: panel ? Math.max(0, box.right - panel.left) : 0,
  };
}

function fly(req: FlyRequest) {
  if (!map) return;
  const animate = !reducedMotion();
  const c = coveredEdges();
  if (req.kind === 'bounds') {
    const [w, s, e, n] = req.bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      {
        padding: { top: c.top + 60, bottom: c.bottom + 60, left: c.left + 60, right: c.right + 60 },
        maxZoom: req.maxZoom ?? 9,
        duration: animate ? 1200 : 0,
      },
    );
  } else {
    // An offset, not camera padding: MapLibre keeps padding after the move.
    map.flyTo({
      center: [req.lng, req.lat],
      zoom: req.zoom,
      offset: [(c.left - c.right) / 2, (c.top - c.bottom) / 2],
      duration: animate ? 1400 : 0,
      essential: false,
    });
  }
}

const records = (n: number, text: string) => `${text} record${n === 1 ? '' : 's'}`;

/** The hovered cell's exact count, once the pointer has rested on it (lib/map/cellCounts.ts). */
const hoverCounter = createHoverCounter((wkt, n) => {
  if (tooltip.value?.wkt === wkt) tooltip.value = { ...tooltip.value, text: records(n, full(n)) };
});

function clearHover() {
  hoverCounter.cancel();
  tooltip.value = null;
  setData('hover', EMPTY);
}

function onMove(e: MapMouseEvent) {
  // Pin mode: no cell hover, the cursor says a click drops the pin.
  if ($mapMode.get() === 'pin') return;
  const f = hexAt(e.point);
  const geom = f && geometryOf(f);
  if (!geom) {
    clearHover();
    map!.getCanvas().style.cursor = '';
    return;
  }
  setData('hover', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: f.geometry }],
  });
  // The tile's count is an estimate (~) until the exact one is known.
  const filter = $occurrenceFilter.get();
  const exact = knownCount(filter, geom.wkt);
  const text =
    exact === undefined ? records(geom.tileTotal, `~${compact(geom.tileTotal)}`) : records(exact, full(exact));
  tooltip.value = { x: e.point.x, y: e.point.y, text, wkt: geom.wkt };
  hoverCounter.hover(filter, geom.wkt);
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
  });
  occ = createOccLayer(map, {
    filter: () => $occurrenceFilter.get(),
    listenFilter: (fn) => $occurrenceFilter.listen(fn),
    onCells: (fc) => {
      replaceHexes(fc);
      if (pendingHexRestore || ($selectedHex.get() && !$hexGeometry.get())) restoreHex();
    },
    onChanges: (add, remove) => {
      changeHexes(add, remove);
      if (pendingHexRestore || ($selectedHex.get() && !$hexGeometry.get())) restoreHex();
    },
    onLevel: (level) => {
      $gridLevel.set(level);
      paintHexes(level);
    },
    onProgress: (done, total) => $mapLoad.set({ loading: done < total, done, total }),
    onFailed: () => (failed.value = true),
  });
  cleanups.push(() => occ?.destroy());
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
  map.on('mouseout', clearHover);
  map.on('click', onClick);
  map.on('style.load', syncOverlays);
  map.getCanvas().addEventListener('keydown', onKey);
  cleanups.push(() => map?.getCanvas().removeEventListener('keydown', onKey));

  // Store → map
  cleanups.push(
    $basemap.listen(() => void rebuildStyle()),
    // A new density ramp only repaints the hexes.
    $ramp.listen(() => paintHexes()),
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
      clearHover();
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
  hoverCounter.cancel();
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
