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
import { useStore } from '@nanostores/vue';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { PHONE_QUERY } from '~/lib/breakpoints';
import { compact, full } from '~/lib/format';
import { createHoverCounter, hasKnownEmpty, knownCount } from '~/lib/map/cellCounts';
import { busiestInView, coveredEdges, ringBox } from '~/lib/map/chrome';
import { keepGlobeTilesOnWrapJumps } from '~/lib/map/globeWrap';
import { hexCentre, zoomPastLevel, type Hex } from '~/lib/map/occGrid';
import { tameAttribution } from '~/lib/map/attribution';
import { flyMap, flyToBounds } from '~/lib/map/camera';
import { createOccLayer, type OccLayer, type OccLayerOptions } from '~/lib/map/occLayer';
import { PIN_CURSOR } from '~/lib/map/pinCursors';
import { createRecordFit } from '~/lib/map/recordFit';
import { sizeRecordLayers } from '~/lib/map/recordZoom';
import { hasCellInView, viewBounds } from '~/lib/map/screen';
import {
  buildStyle,
  EMPTY,
  fillColor,
  geometryOf,
  nearGeoJson,
  selectedGeoJson,
  type MapColors,
} from '~/lib/map/style';
import type { ScreenBox } from '~/lib/tour';
import {
  $basemap,
  clearHexSelection,
  type HexPoint,
  $mapView,
  $panel,
  sameView,
  $selectedHex,
} from '~/stores/explorer';
import { $occurrenceFilter } from '~/stores/filters';
import {
  $busiestHexBox,
  $busiestHexRequest,
  $flyTo,
  $gridLevel,
  $hexGeometry,
  $mapBounds,
  $mapLoad,
  $mapMode,
  $mapUnsupported,
  $recordPlace,
  $tilesFailed,
  $viewCheck,
} from '~/stores/map-messages';
import { flyToLinkedTaxa } from '~/stores/fly-to-taxa';
import { $nearAt, $nearRadius, setNearLocation } from '~/stores/near';
import { $lightboxOpen } from '~/stores/lightbox';
import { $ramp } from '~/stores/ramp';
import { $reading, mapPixelRatio, prefersReducedMotion } from '~/stores/reading';
import WebglNotice from './WebglNotice.vue';

const container = ref<HTMLDivElement>();
const unsupported = useStore($mapUnsupported);
/** Hidden, the canvas drops out of the page's drawing, so zooming a photo doesn't redraw it too. */
const isLightboxOpen = useStore($lightboxOpen);
const tooltip = ref<{ x: number; y: number; text: string; wkt: string } | null>(null);

let map: MlMap | undefined;
let occurrenceLayer: OccLayer | undefined;
const cleanups: (() => void)[] = [];

// MapLibre 6 renders with WebGL2 only; without it the constructor throws.
const hasWebgl2 = () => Boolean(document.createElement('canvas').getContext('webgl2'));

const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
const theme = (): 'dark' | 'light' => (document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark');
const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Theme colours from the CSS custom properties (fallbacks match the dark theme). */
function colors(): MapColors {
  return {
    accent: css('--accent', '#e89141'),
    accentContrast: css('--accent-contrast', '#1d1404'),
    bg: css('--bg', '#0e1813'),
    land: css('--map-land', '#2c4437'),
    text: css('--text', '#f2ede2'),
  };
}

/** The "near me" pin and circle, shown only while the map is in pin mode. */
const nearData = () => nearGeoJson($mapMode.get() === 'pin' ? $nearAt.get() : null, $nearRadius.get());

/** Replace a GeoJSON source's data, if the style has that source yet. */
function setData(source: string, data: GeoJSON.GeoJSON) {
  (map?.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

/** The map's hex layer. */
const HEX_LAYER = 'occ-fill';
/** Below this the grid drops to level 0, whose single tile wraps onto itself and GBIF's cells overlap at the antimeridian. */
const MIN_ZOOM = 1;

/** Colour the hexes with the bins for this grid level. */
function paintHexes(level = $gridLevel.get()) {
  if (map?.getLayer(HEX_LAYER)) map.setPaintProperty(HEX_LAYER, 'fill-color', fillColor(level));
}

/** Cells arriving or leaving as you pan, sent to MapLibre's worker as one diff (no fade-in: that sent each cell twice). */
function changeHexes(add: Hex[], remove: string[]) {
  void (map?.getSource('occ') as GeoJSONSource | undefined)?.updateData({ add, remove });
}

/** A whole new set of cells (new level or filters). */
function replaceHexes(collection: GeoJSON.FeatureCollection) {
  setData('occ', collection);
}

/**
 * Push the current overlay data into a freshly loaded style. A style is built
 * from the stores, then loads asynchronously; a store change in between (near
 * me switching to pin mode on a reload, say) finds no source and would be lost.
 */
function syncOverlays() {
  replaceHexes(occurrenceLayer?.collection() ?? EMPTY);
  // The grid level is set as the map starts, usually before its style has loaded.
  paintHexes();
  setData('selected', selectedGeoJson($hexGeometry.get(), $recordPlace.get()));
  setData('near', nearData());
  sizeRecordPlace();
}

/** The viewer's choices a style is built from, as one comparable value. */
const currentStyleChoice = () => `${$basemap.get()} ${theme()}`;

function styleFor() {
  return buildStyle($basemap.get(), theme(), colors(), {
    hexes: occurrenceLayer?.collection() ?? EMPTY,
    level: $gridLevel.get(),
    selected: selectedGeoJson($hexGeometry.get(), $recordPlace.get()),
    near: nearData(),
  });
}

/**
 * Whether a screen point misses the globe (space around it at low zoom).
 * There, unproject snaps to the horizon, so the point does not round-trip.
 */
function offGlobe(point: { x: number; y: number }): boolean {
  if (!map) return true;
  const back = map.project(map.unproject([point.x, point.y]));
  return Math.hypot(back.x - point.x, back.y - point.y) > 1;
}

/** The hex cell under a screen point, if any. */
function hexAt(point: { x: number; y: number }): Hex | undefined {
  if (!map || !occurrenceLayer || offGlobe(point)) return undefined;
  const lngLat = map.unproject([point.x, point.y]);
  return occurrenceLayer.cellAt([lngLat.lng, lngLat.lat]);
}

function selectAt(point: { x: number; y: number }, lngLat: { lng: number; lat: number }) {
  const feature = hexAt(point);
  const geometry = feature && geometryOf(feature);
  if (!geometry) {
    clearHexSelection();
    return;
  }
  $hexGeometry.set(geometry);
  $selectedHex.set(hexPoint(lngLat.lng, lngLat.lat));
  $panel.set('hex');
}

/** A selected hex for the URL: the point, rounded, and the grid level its cell is from. */
function hexPoint(lng: number, lat: number): HexPoint {
  return [Number(lng.toFixed(4)), Number(lat.toFixed(4)), $gridLevel.get()];
}

/** Re-resolve a hex selected via the URL at its level, wherever it is; a link to a cell with no records drops it. */
async function restoreHex() {
  const selected = $selectedHex.get();
  if (!occurrenceLayer || !selected || $hexGeometry.get()) return;
  const [lng, lat, level = $gridLevel.get()] = selected;
  const feature = await occurrenceLayer.findCell([lng, lat], level);
  // Another hex was picked meanwhile.
  if ($selectedHex.get() !== selected) return;
  const geometry = feature && geometryOf(feature);
  if (!geometry) {
    clearHexSelection();
    return;
  }
  $hexGeometry.set(geometry);
}

/** The outline of the hex the tour or a hint points at, kept so its box can follow the map. */
let pointedRing: [number, number][] | null = null;

/** Tour and hints: find the busiest hex in view, select it if asked (panel closed), and publish where it is. */
function findBusiestHex(shouldSelect: boolean) {
  const hex = map && occurrenceLayer ? busiestInView(map, occurrenceLayer.collection().features as Hex[]) : undefined;
  const geometry = hex && geometryOf(hex);
  pointedRing = geometry ? geometry.ring : null;
  if (hex && geometry && shouldSelect) {
    const [lng, lat] = hexCentre(hex);
    $hexGeometry.set(geometry);
    $selectedHex.set(hexPoint(lng, lat));
  }
  $busiestHexBox.set(pointedBox());
}

/** The pointed-at hex's box on screen, in viewport px. */
const pointedBox = (): ScreenBox | null => (map && pointedRing ? ringBox(map, pointedRing) : null);

/** Keep the tour's or hint's hex box on its hex as the map moves or resizes. */
function followBusiestHex() {
  if ($busiestHexBox.get()) $busiestHexBox.set(pointedBox());
}

const records = (count: number, text: string) => `${text} record${count === 1 ? '' : 's'}`;

/** The hovered cell's exact count, once the pointer has rested on it (lib/map/cellCounts.ts). */
const hoverCounter = createHoverCounter((wkt, count) => {
  if (count === 0) {
    clearHover();
    occurrenceLayer?.redraw();
  } else if (tooltip.value?.wkt === wkt) tooltip.value = { ...tooltip.value, text: records(count, full(count)) };
});

/** A cell whose exact count is known to be 0. */
function knownEmpty(hex: Hex): boolean {
  const filter = $occurrenceFilter.get();
  // Asked of every cell on every draw: skip building its WKT when no cell is known to be empty.
  if (!hasKnownEmpty(filter)) return false;
  const geometry = geometryOf(hex);
  return !!geometry && knownCount(filter, geometry.wkt) === 0;
}

function clearHover() {
  hoverCounter.cancel();
  tooltip.value = null;
  setData('hover', EMPTY);
}

function onMove(event: MapMouseEvent) {
  // Pin mode: no cell hover, the cursor says a click drops the pin.
  // Dragging: the tooltip stays hidden until the drag ends (dragstart clears it).
  if ($mapMode.get() === 'pin' || map!.dragPan.isActive()) return;
  const feature = hexAt(event.point);
  const geometry = feature && geometryOf(feature);
  if (!geometry) {
    clearHover();
    map!.getCanvas().style.cursor = '';
    return;
  }
  // Moving within the same cell only moves the tooltip; skip resending the outline to the map worker.
  if (tooltip.value?.wkt !== geometry.wkt)
    setData('hover', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: feature.geometry }],
    });
  // The tile's count is an estimate (~) until the exact one is known.
  const filter = $occurrenceFilter.get();
  const exact = knownCount(filter, geometry.wkt);
  const text =
    exact === undefined ? records(geometry.tileTotal, `~${compact(geometry.tileTotal)}`) : records(exact, full(exact));
  tooltip.value = { x: event.point.x, y: event.point.y, text, wkt: geometry.wkt };
  hoverCounter.hover(filter, geometry.wkt);
  map!.getCanvas().style.cursor = 'pointer';
}

function onClick(event: MapMouseEvent) {
  if (!map || offGlobe(event.point)) return;
  if ($mapMode.get() === 'pin') {
    setNearLocation(event.lngLat.lat, event.lngLat.lng);
    return;
  }
  selectAt(event.point, event.lngLat);
}

function onKey(event: KeyboardEvent) {
  if (!map) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const canvas = map.getCanvas();
    const point = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const lngLat = map.unproject([point.x, point.y]);
    if ($mapMode.get() === 'pin') setNearLocation(lngLat.lat, lngLat.lng);
    else selectAt(point, lngLat);
  } else if (event.key === 'Escape') {
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

type MapLibre = typeof import('maplibre-gl');

/** MapLibre's own tile and label cross-fade. */
const MAP_FADE_MS = 200;

/** Canvas pixels per CSS pixel while a lightbox hides the map. */
const PAUSED_PIXEL_RATIO = 1;

/** Loads MapLibre and points it at the bundled worker. */
async function loadMapLibre(): Promise<MapLibre> {
  const [maplibre, worker] = await Promise.all([
    import('maplibre-gl'),
    // MapLibre derives its worker URL from import.meta.url, which breaks once
    // bundled; ship the self-contained worker as an asset instead.
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
  ]);
  maplibre.setWorkerUrl(worker.default);
  return maplibre;
}

/** How the occurrence layer reads the filter and reports cells, level, progress and failure. */
function occLayerOptions(): OccLayerOptions {
  return {
    filter: () => $occurrenceFilter.get(),
    listenFilter: (onChange) => $occurrenceFilter.listen(onChange),
    isEmpty: knownEmpty,
    onCells: replaceHexes,
    onChanges: changeHexes,
    onLevel: (level) => {
      $gridLevel.set(level);
      paintHexes(level);
    },
    onProgress: (done, total) => $mapLoad.set({ loading: done < total, done, total }),
    onFailed: () => $tilesFailed.set(true),
  };
}

/** Publish the visible extent. */
function publishBounds() {
  if (map) $mapBounds.set(viewBounds(map));
}

/** Once the map has settled and every hex tile is in: whether any cell is drawn in view. */
function publishEmpty() {
  if (!map || $mapLoad.get().loading) return;
  const hasLayer = Boolean(map.getLayer(HEX_LAYER));
  $viewCheck.set({ isEmpty: !$tilesFailed.get() && hasLayer && !hasCellInView(map, HEX_LAYER) });
}

/** After a move: publish the new extent and view, unless the view is already the stored one. */
function onMoveEnd() {
  if (!map) return;
  publishBounds();
  const center = map.getCenter();
  const next = { lng: center.lng, lat: center.lat, zoom: map.getZoom() };
  if (!sameView(next, $mapView.get())) $mapView.set(next);
}

const MAP_ARIA_LABEL =
  'Map of occurrence records. Use arrow keys to pan, plus and minus to zoom, Enter to select the cell under the crosshair, Escape to clear.';

/** Controls, accessibility label, dev hook and size tracking for a freshly created map. */
function decorateMap(maplibre: MapLibre, element: HTMLElement) {
  if (!map) return;
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
  if (import.meta.env.DEV) (window as unknown as { __map?: MlMap }).__map = map;
  map.touchZoomRotate.disableRotation();
  map.getCanvas().setAttribute('aria-label', MAP_ARIA_LABEL);
  // Track container size (window resize alone misses layout changes).
  const resizeObserver = new ResizeObserver(() => map?.resize());
  resizeObserver.observe(element);
  cleanups.push(() => resizeObserver.disconnect());
}

/** Wires the map's own events: extent, view, hover, click, style loads and keyboard. */
function listenToMap() {
  if (!map) return;
  map.once('load', publishBounds);
  if (container.value) cleanups.push(tameAttribution(map, container.value, isPhone()));
  map.on('moveend', onMoveEnd);
  map.on('idle', publishEmpty);
  map.on('move', followBusiestHex);
  map.on('resize', followBusiestHex);
  map.on('mousemove', onMove);
  map.on('mouseout', clearHover);
  map.on('dragstart', clearHover);
  map.on('click', onClick);
  map.on('style.load', syncOverlays);
  map.getCanvas().addEventListener('keydown', onKey);
  cleanups.push(() => map?.getCanvas().removeEventListener('keydown', onKey));
}

/** The hex tiles for the view are all in: repaint. */
function onLoadChange(load: { loading: boolean }) {
  // A load that drew nothing new renders nothing, so no idle follows: ask for one.
  if (!load.loading) map?.triggerRepaint();
}

/** Store → map: view, basemap, ramp, selection, mode, "near me" and fly requests. */
function listenToStores() {
  // A flight planned before the first style loads is measured on the flat map and breaks when the globe switches on.
  const globeReady = new Promise<void>((resolve) => map?.once('style.load', () => resolve()));
  cleanups.push(
    $basemap.listen(() => void rebuildStyle()),
    $mapLoad.listen(onLoadChange),
    // A new density ramp only repaints the hexes.
    $ramp.listen(() => paintHexes()),
    $mapView.listen((view) => {
      if (!map) return;
      const center = map.getCenter();
      if (!sameView(view, { lng: center.lng, lat: center.lat, zoom: map.getZoom() }))
        map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });
    }),
    ...[$hexGeometry, $recordPlace].map((store) =>
      store.listen(() => setData('selected', selectedGeoJson($hexGeometry.get(), $recordPlace.get()))),
    ),
    $selectedHex.listen((selected) => {
      if (!selected) $hexGeometry.set(null);
      else void restoreHex();
    }),
    $mapMode.subscribe((mode) => {
      if (!map) return;
      clearHover();
      map.getCanvas().style.cursor = mode === 'pin' ? PIN_CURSOR : '';
    }),
    ...[$nearAt, $nearRadius, $mapMode].map((store) => store.listen(() => setData('near', nearData()))),
    $flyTo.subscribe((request) => {
      if (!request) return;
      $flyTo.set(null);
      void globeReady.then(() => map && flyMap(map, request));
    }),
    $reading.listen(() => map?.setPixelRatio(mapPixelRatio())),
    // Hidden behind a lightbox, the smallest drawing buffer frees the most memory for the photo's pinch-zoom.
    $lightboxOpen.listen((isOpen) => map?.setPixelRatio(isOpen ? PAUSED_PIXEL_RATIO : mapPixelRatio())),
    $busiestHexRequest.subscribe((request) => {
      if (!request) return;
      $busiestHexRequest.set(null);
      findBusiestHex(request === 'select');
    }),
  );
}

/** Go to an expanded record, or zoom out to its large area, and back again (lib/map/recordFit.ts); size its area. */
function followRecord() {
  const recordMap = map;
  if (!recordMap) return;
  const fit = createRecordFit({
    map: recordMap,
    coveredEdges: () => coveredEdges(recordMap),
    // To the box's own middle: fitting a padded box on a small globe can leave a lone point on the globe's rim.
    fitBox: (bbox, maxZoom) => {
      const [west, south, east, north] = bbox;
      const centre = [(west + east) / 2, (south + north) / 2] as const;
      flyToBounds(recordMap, { kind: 'bounds', bbox, maxZoom, centre });
    },
  });
  // As with $flyTo, a flight planned before the first style loads breaks, so a record open from the URL waits for it.
  let isStyleLoaded = false;
  recordMap.once('style.load', () => {
    isStyleLoaded = true;
    fit($recordPlace.get());
  });
  // The zoom where the grid turns finer moves with the centre's latitude and the filters.
  recordMap.on('moveend', sizeRecordPlace);
  cleanups.push(
    $recordPlace.listen((place) => isStyleLoaded && fit(place)),
    $hexGeometry.listen(sizeRecordPlace),
    $gridLevel.listen(sizeRecordPlace),
    () => recordMap.off('moveend', sizeRecordPlace),
  );
}

/** Size the expanded record's area for the selected cell (lib/map/recordZoom.ts). */
function sizeRecordPlace() {
  if (!map) return;
  sizeRecordLayers(map, $hexGeometry.get() ? gridFinerZoom() : Infinity);
}

/** The zoom where the grid at the map's latitude turns finer than the selected cell; Infinity if never or unknown. */
function gridFinerZoom(): number {
  const selectedLevel = $selectedHex.get()?.[2];
  if (!map || !occurrenceLayer || selectedLevel === undefined) return Infinity;
  const layer = occurrenceLayer;
  const centreLat = map.getCenter().lat;
  return zoomPastLevel((zoom) => layer.levelAt(zoom, centreLat), selectedLevel, map.getMaxZoom());
}

/** Page-level events: theme switches and client-side page swaps. */
function listenToPage() {
  // Theme switch: the plain basemap and accent colours follow it.
  const observer = new MutationObserver(() => void rebuildStyle());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => observer.disconnect());

  // The map is persisted across ClientRouter swaps; size may have changed.
  const onSwap = () => requestAnimationFrame(() => map?.resize());
  document.addEventListener('astro:after-swap', onSwap);
  cleanups.push(() => document.removeEventListener('astro:after-swap', onSwap));
}

/**
 * Resolves once the page shows the map: at once on the map, or on the swap to it.
 * A visit that starts on /tree (map hidden) then never pays for MapLibre, the basemap or hex tiles.
 */
function mapShown(element: HTMLElement): Promise<void> {
  const isShown = () => element.closest('.app-shell')?.getAttribute('data-map') !== 'hidden';
  if (isShown()) return Promise.resolve();
  return new Promise((resolve) => {
    const onSwap = () => {
      if (!isShown()) return;
      document.removeEventListener('astro:after-swap', onSwap);
      resolve();
    };
    document.addEventListener('astro:after-swap', onSwap);
    cleanups.push(() => document.removeEventListener('astro:after-swap', onSwap));
  });
}

onMounted(async () => {
  if (!container.value) return;
  await mapShown(container.value);
  if (!hasWebgl2()) {
    $mapUnsupported.set(true);
    $mapLoad.set({ loading: false, done: 0, total: 0 });
    return;
  }
  const maplibre = await loadMapLibre();
  if (!container.value) return;
  const view = $mapView.get();
  const styleChoice = currentStyleChoice();
  const style = await styleFor();
  const element = container.value;
  if (!element) return;
  map = new maplibre.Map({
    container: element,
    style,
    center: [view.lng, view.lat],
    zoom: view.zoom,
    minZoom: MIN_ZOOM,
    attributionControl: { compact: true },
    maxPitch: 0,
    dragRotate: false,
    renderWorldCopies: false,
    fadeDuration: prefersReducedMotion() ? 0 : MAP_FADE_MS,
    pixelRatio: mapPixelRatio(),
  });
  keepGlobeTilesOnWrapJumps(map);
  occurrenceLayer = createOccLayer(map, occLayerOptions());
  void restoreHex();
  cleanups.push(() => occurrenceLayer?.destroy());
  decorateMap(maplibre, element);
  listenToMap();
  listenToStores();
  flyToLinkedTaxa();
  followRecord();
  listenToPage();
  // A basemap or theme picked while the first style loaded came before the listeners above.
  if (currentStyleChoice() !== styleChoice) void rebuildStyle();
});

onBeforeUnmount(() => {
  hoverCounter.cancel();
  cleanups.forEach((cleanup) => cleanup());
  map?.remove();
  map = undefined;
});
</script>

<template>
  <div class="map-canvas relative size-full" data-testid="map">
    <div
      ref="container"
      class="size-full"
      :class="{ invisible: isLightboxOpen }"
      role="region"
      aria-label="Occurrence map"
    ></div>
    <div class="crosshair" aria-hidden="true"></div>
    <div
      v-if="tooltip"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] rounded-sm bg-surface px-2 py-1 text-xs text-text shadow-panel"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      {{ tooltip.text }}
    </div>
    <WebglNotice v-if="unsupported" />
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
/* Zoom and info match the app's floating buttons: 40px squares, --radius corners, the house stroke icons drawn in
   the theme's text colours through a mask, 0.75rem in from the edge and 0.5rem apart. */
.map-canvas .maplibregl-ctrl-bottom-right {
  bottom: 0.25rem;
}
.map-canvas .maplibregl-ctrl-bottom-right .maplibregl-ctrl {
  margin: 0 0.75rem 0.5rem 0;
}

.map-canvas .maplibregl-ctrl-group {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.map-canvas .maplibregl-ctrl-group button {
  width: 2.5rem;
  height: 2.5rem;
}
.map-canvas .maplibregl-ctrl-group button + button {
  border-top: 1px solid var(--border);
}
/* The house focus ring, only for keyboard focus, in place of MapLibre's blue glow on every tap. */
.map-canvas .maplibregl-ctrl-group button:focus,
.map-canvas .maplibregl-ctrl-attrib-button:focus {
  box-shadow: none;
}
.map-canvas .maplibregl-ctrl-group button:focus-visible,
.map-canvas .maplibregl-ctrl-attrib-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.map-canvas .maplibregl-ctrl-group button:not(:disabled):hover {
  background: var(--surface-2);
}
.map-canvas .maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon,
.map-canvas .maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon {
  background: var(--text);
  mask: var(--control-icon) center / 1.125rem no-repeat;
}
.map-canvas .maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon {
  --control-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'%3E%3Cpath d='M12 6v12M6 12h12'/%3E%3C/svg%3E");
}
.map-canvas .maplibregl-ctrl-zoom-out .maplibregl-ctrl-icon {
  --control-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'%3E%3Cpath d='M6 12h12'/%3E%3C/svg%3E");
}

/* The folded attribution is the info button: the same square, a stroke "i" in muted text. */
.map-canvas .maplibregl-ctrl-attrib.maplibregl-compact {
  box-sizing: border-box;
  min-height: 2.5rem;
  min-width: 2.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.map-canvas .maplibregl-ctrl-attrib.maplibregl-compact .maplibregl-ctrl-attrib-button {
  width: calc(2.5rem - 2px);
  height: calc(2.5rem - 2px);
  border-radius: calc(var(--radius) - 1px);
  background: none;
}
.map-canvas .maplibregl-ctrl-attrib.maplibregl-compact .maplibregl-ctrl-attrib-button::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--text-muted);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='8.5'/%3E%3Cpath d='M12 11v5M12 8h.01'/%3E%3C/svg%3E")
    center / 1.125rem no-repeat;
}
.map-canvas .maplibregl-ctrl-attrib.maplibregl-compact .maplibregl-ctrl-attrib-button:hover::before {
  background: var(--text);
}
.map-canvas .maplibregl-ctrl-attrib.maplibregl-compact-show {
  padding: 0.5rem 2.75rem 0.5rem 0.75rem;
}

.map-canvas .maplibregl-ctrl-attrib {
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--text-muted);
}

/* Expanded attribution must sit above the records-per-year dock, or it's hidden on mobile.
   The overlay is one stacking context, so only lift it while no panel or flyout is open. */
.app-shell:has(.bottom-dock):not(:has(.side-panel, .bottom-sheet, #filter-flyout))
  .map-canvas
  .maplibregl-ctrl-bottom-right:has(.maplibregl-compact-show) {
  z-index: 20;
}

/* Phones and tablets: the zoom and info buttons sit above the bottom row of buttons (ExplorerOverlay), info on top so
   the zoom stays nearest the thumb. */
@media (max-width: 999.98px) {
  .app-shell:has(.phone-bottom-row) .map-canvas .maplibregl-ctrl-bottom-right {
    bottom: 3.5rem;
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
  }
}

.map-canvas .maplibregl-ctrl-attrib.maplibregl-compact-show {
  background: var(--surface);
}

/* Pin the "i" button to the bottom so it stays put when the text wraps upwards. */
.map-canvas .maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib-button {
  top: auto;
  bottom: 0;
}

.map-canvas .maplibregl-ctrl-attrib a {
  text-decoration: underline;
  color: var(--text);
}

.map-canvas canvas:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
