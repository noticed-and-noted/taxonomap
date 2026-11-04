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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { compact, full } from '~/lib/format';
import { createHoverCounter, hasKnownEmpty, knownCount } from '~/lib/map/cellCounts';
import { busiestInView, coveredEdges, ringBox } from '~/lib/map/chrome';
import { keepGlobeTilesOnWrapJumps } from '~/lib/map/globeWrap';
import { hexCentre, zoomPastLevel, type Hex } from '~/lib/map/occGrid';
import {
  createHexSource,
  type CubeKit,
  type HexSource,
  type HexSourceOptions,
  type HexSourceState,
} from '~/lib/map/hexSource';
import { createOccLayer, type OccLayer, type OccLayerOptions } from '~/lib/map/occLayer';
import { PIN_CURSOR } from '~/lib/map/pinCursors';
import { createRecordFit } from '~/lib/map/recordFit';
import { fillsCanvas, isOnScreen } from '~/lib/map/screen';
import {
  buildStyle,
  EMPTY,
  fillColor,
  geometryOf,
  nearGeoJson,
  RECORD_AREA_LAYERS,
  RECORD_DOT_LAYER,
  RECORD_MIN_ZOOM,
  recordDotMinZoom,
  selectedGeoJson,
  type MapColors,
} from '~/lib/map/style';
import type { ScreenBox } from '~/lib/tour';
import {
  $basemap,
  $busiestHexBox,
  $busiestHexRequest,
  $flyTo,
  $gridLevel,
  $hexGeometry,
  $mapBounds,
  $mapLoad,
  $mapUnsupported,
  $mapMode,
  $mapView,
  $occurrenceFilter,
  $selectedHex,
  $panel,
  $recordPlace,
  $viewCheck,
  clearHexSelection,
  sameView,
  type FlyRequest,
  type HexPoint,
} from '~/stores/explorer';
import { $cubesOn, $openCubes, CUBES_BASE } from '~/stores/cubes';
import { $nearAt, $nearRadius, setNearLocation } from '~/stores/near';
import { $ramp } from '~/stores/ramp';
import { $reading, mapPixelRatio, prefersReducedMotion } from '~/stores/reading';
import { lookupTaxon } from '~/stores/taxon';
import WebglNotice from './WebglNotice.vue';

const container = ref<HTMLDivElement>();
const failed = ref(false);
const unsupported = useStore($mapUnsupported);
const tooltip = ref<{ x: number; y: number; text: string; wkt: string } | null>(null);

let map: MlMap | undefined;
let hexSource: HexSource | undefined;
/** Where the hexes come from (GBIF or the sample cubes), for the notice on the map. */
const hexState = ref<HexSourceState>({ kind: 'gbif' });
const cleanups: (() => void)[] = [];

/** The layer drawing the hexes now: GBIF's tiles, or the cubes (see lib/map/hexSource.ts). */
const occurrenceLayer = (): OccLayer | undefined => hexSource?.layer();

// MapLibre 6 renders with WebGL2 only; without it the constructor throws.
const hasWebgl2 = () => Boolean(document.createElement('canvas').getContext('webgl2'));

const isPhone = () => window.matchMedia('(max-width: 639px)').matches;
const theme = (): 'dark' | 'light' => (document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark');
const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Theme colours from the CSS custom properties (fallbacks match the dark theme). */
function colors(): MapColors {
  return {
    accent: css('--accent', '#f0b443'),
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
  replaceHexes(occurrenceLayer()?.collection() ?? EMPTY);
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
    hexes: occurrenceLayer()?.collection() ?? EMPTY,
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
  const layer = occurrenceLayer();
  if (!map || !layer || offGlobe(point)) return undefined;
  const lngLat = map.unproject([point.x, point.y]);
  return layer.cellAt([lngLat.lng, lngLat.lat]);
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
  const layer = occurrenceLayer();
  if (!layer || !selected || $hexGeometry.get()) return;
  const [lng, lat, level = $gridLevel.get()] = selected;
  const feature = await layer.findCell([lng, lat], level);
  // Another hex was picked meanwhile.
  if ($selectedHex.get() !== selected) return;
  const geometry = feature && geometryOf(feature);
  if (!geometry) {
    clearHexSelection();
    return;
  }
  $hexGeometry.set(geometry);
  if ($panel.get() === 'none') $panel.set('hex');
}

/** The outline of the hex the tour or a hint points at, kept so its box can follow the map. */
let pointedRing: [number, number][] | null = null;

/** Tour and hints: find the busiest hex in view, select it if asked (panel closed), and publish where it is. */
function findBusiestHex(shouldSelect: boolean) {
  const layer = occurrenceLayer();
  const hex = map && layer ? busiestInView(map, layer.collection().features as Hex[]) : undefined;
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

/** Breathing room between a fitted area and the map's edges, in px. */
const FIT_PADDING = 60;
const FIT_MAX_ZOOM = 9;
const FIT_DURATION_MS = 1200;
const FLIGHT_DURATION_MS = 1400;

/** Fit a box clear of the floating chrome, or fly to a chosen centre at the zoom that fits it. */
function flyToBounds(request: Extract<FlyRequest, { kind: 'bounds' }>) {
  if (!map) return;
  const covered = coveredEdges(map);
  const [west, south, east, north] = request.bbox;
  const bounds: [[number, number], [number, number]] = [
    [west, south],
    [east, north],
  ];
  const fit = {
    padding: {
      top: covered.top + FIT_PADDING,
      bottom: covered.bottom + FIT_PADDING,
      left: covered.left + FIT_PADDING,
      right: covered.right + FIT_PADDING,
    },
    maxZoom: request.maxZoom ?? FIT_MAX_ZOOM,
  };
  if (!request.centre) {
    map.fitBounds(bounds, { ...fit, duration: prefersReducedMotion() ? 0 : FIT_DURATION_MS });
    return;
  }
  const zoom = map.cameraForBounds(bounds, fit)?.zoom ?? map.getZoom();
  fly({ kind: 'point', lng: request.centre[0], lat: request.centre[1], zoom });
}

function fly(request: FlyRequest) {
  if (!map) return;
  if (request.kind === 'bounds') {
    flyToBounds(request);
    return;
  }
  const covered = coveredEdges(map);
  // An offset, not camera padding: MapLibre keeps padding after the move.
  map.flyTo({
    center: [request.lng, request.lat],
    zoom: request.zoom,
    offset: [(covered.left - covered.right) / 2, (covered.top - covered.bottom) / 2],
    duration: prefersReducedMotion() ? 0 : FLIGHT_DURATION_MS,
    essential: false,
  });
}

const records = (count: number, text: string) => `${text} record${count === 1 ? '' : 's'}`;

/** The hovered cell's exact count, once the pointer has rested on it (lib/map/cellCounts.ts). */
const hoverCounter = createHoverCounter((wkt, count) => {
  if (count === 0) {
    clearHover();
    occurrenceLayer()?.redraw();
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
  // A cube hex's count is the cubes' own; asking GBIF for it would bring back the search the cubes replace.
  if (geometry.cell) hoverCounter.cancel();
  else hoverCounter.hover(filter, geometry.wkt);
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
    onFailed: () => (failed.value = true),
  };
}

/** The cube code and files, loaded the first time the cube setting needs them (and again after a failure). */
let cubeKit: Promise<CubeKit> | null = null;

function loadCubes(): Promise<CubeKit> {
  cubeKit ??= (async () => {
    const [{ createCubeLayer }, { openCubes }] = await Promise.all([
      import('~/lib/map/cubeLayer'),
      import('~/lib/cubes/reader'),
    ]);
    const cubes = await openCubes(CUBES_BASE!);
    $openCubes.set(cubes);
    return {
      cubes,
      createLayer: (query, onFailed) => createCubeLayer(map!, { ...liveLayerOptions(), onFailed, cubes, query }),
    };
  })();
  cubeKit.catch(() => (cubeKit = null));
  return cubeKit;
}

/** Counts layers started, so a replaced layer's last queued draw can't overwrite its successor's cells. */
let layerSeq = 0;

/** The occurrence layer's options for a new layer, whose callbacks go quiet once another layer starts. */
function liveLayerOptions(): OccLayerOptions {
  const seq = ++layerSeq;
  const options = occLayerOptions();
  const isLive = () => seq === layerSeq;
  return {
    ...options,
    onCells: (cells) => isLive() && options.onCells(cells),
    onChanges: (add, remove) => isLive() && options.onChanges(add, remove),
    onLevel: (level) => isLive() && options.onLevel(level),
    onProgress: (done, total) => isLive() && options.onProgress(done, total),
  };
}

/** How the hex source starts layers, reads the view and reports which source is drawing. */
function hexSourceOptions(target: MlMap): HexSourceOptions {
  return {
    createGbifLayer: () => createOccLayer(target, liveLayerOptions()),
    loadCubes,
    isCubesOn: () => $cubesOn.get(),
    filter: () => $occurrenceFilter.get(),
    zoom: () => target.getZoom(),
    lookup: lookupTaxon,
    onState: (state) => (hexState.value = state),
  };
}

/** Pick the hex layer again when the filters, the zoom or the cube setting change. */
function listenForHexSource(target: MlMap) {
  const update = () => void hexSource?.update();
  target.on('moveend', update);
  cleanups.push(
    $occurrenceFilter.listen(update),
    $cubesOn.listen(() => void hexSource?.retry()),
    () => target.off('moveend', update),
  );
  // A hex selected in the URL is found once the first layer is picked.
  void hexSource?.update().then(restoreHex);
}

/** The share of GBIF's records the sample cubes hold, as a percentage for the notice. */
const samplePercent = computed(() =>
  hexState.value.kind === 'cubes' ? `${Number((hexState.value.sampleShare * 100).toPrecision(2))}%` : '',
);

/** Below this zoom the canvas corners miss the globe, so the extent is the whole world. */
const WORLD_BOUNDS_MAX_ZOOM = 2.5;
const WORLD_BOUNDS: [number, number, number, number] = [-180, -85, 180, 85];
const MAX_MERCATOR_LAT = 85;

/**
 * Visible extent from the canvas corners and edge midpoints (getBounds() is
 * world-wide under the globe projection). At very low zoom, corners miss the
 * globe: world.
 */
function publishBounds() {
  if (!map) return;
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (map.getZoom() < WORLD_BOUNDS_MAX_ZOOM || !width || !height) {
    $mapBounds.set(WORLD_BOUNDS);
    return;
  }
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
    [width / 2, 0],
    [width / 2, height],
  ].map(([pixelX, pixelY]) => map!.unproject([pixelX as number, pixelY as number]));
  const lngs = corners.map((corner) => corner.lng);
  const lats = corners.map((corner) => corner.lat);
  $mapBounds.set([
    Math.min(...lngs),
    Math.max(-MAX_MERCATOR_LAT, Math.min(...lats)),
    Math.max(...lngs),
    Math.min(MAX_MERCATOR_LAT, Math.max(...lats)),
  ]);
}

/**
 * Whether any cell is drawn in view. A whole-canvas query finds nothing under the globe
 * once the canvas reaches past its rim, so only then look for a cell corner on screen.
 */
function hasCellInView(map: MlMap): boolean {
  if (map.queryRenderedFeatures({ layers: [HEX_LAYER] }).length) return true;
  if (fillsCanvas(map)) return false;
  const source = map.getLayer(HEX_LAYER)!.source;
  return map.querySourceFeatures(source).some((feature) => {
    const { geometry } = feature;
    if (geometry.type !== 'Polygon') return false;
    return geometry.coordinates.some((ring) => ring.some(([lng = 0, lat = 0]) => isOnScreen(map, [lng, lat])));
  });
}

/** Once the map has settled and every hex tile is in: whether any cell is drawn in view. */
function publishEmpty() {
  if (!map || $mapLoad.get().loading) return;
  const hasLayer = Boolean(map.getLayer(HEX_LAYER));
  $viewCheck.set({ isEmpty: !failed.value && hasLayer && !hasCellInView(map) });
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

/** MapLibre opens the compact attribution once its text arrives; on a phone it covers too much map. */
function collapseAttribution() {
  const attribution = container.value?.querySelector('.maplibregl-compact');
  if (!attribution) return;
  attribution.classList.remove('maplibregl-compact-show');
  map?.off('sourcedata', collapseAttribution);
}

/** Closes the open attribution when a press lands anywhere outside it. */
function onPointerDownOutsideAttribution(event: PointerEvent) {
  const attribution = container.value?.querySelector('.maplibregl-compact-show');
  if (attribution && !attribution.contains(event.target as Node))
    attribution.classList.remove('maplibregl-compact-show');
}

/** Wires the map's own events: extent, view, hover, click, style loads and keyboard. */
function listenToMap() {
  if (!map) return;
  map.once('load', publishBounds);
  if (isPhone()) map.on('sourcedata', collapseAttribution);
  document.addEventListener('pointerdown', onPointerDownOutsideAttribution);
  cleanups.push(() => document.removeEventListener('pointerdown', onPointerDownOutsideAttribution));
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
      fly(request);
      $flyTo.set(null);
    }),
    $reading.listen(() => map?.setPixelRatio(mapPixelRatio())),
    $busiestHexRequest.subscribe((request) => {
      if (!request) return;
      $busiestHexRequest.set(null);
      findBusiestHex(request === 'select');
    }),
  );
}

/** Zoom out to show an expanded record's whole obscured area, and back again (lib/map/recordFit.ts); size its dot. */
function followRecord() {
  const recordMap = map;
  if (!recordMap) return;
  const fit = createRecordFit({
    map: recordMap,
    coveredEdges: () => coveredEdges(recordMap),
    fitBox: (bbox, maxZoom) => flyToBounds({ kind: 'bounds', bbox, maxZoom }),
  });
  // The zoom where the grid turns finer moves with the centre's latitude and the filters.
  recordMap.on('moveend', sizeRecordPlace);
  cleanups.push(
    $recordPlace.listen(fit),
    $hexGeometry.listen(sizeRecordPlace),
    $gridLevel.listen(sizeRecordPlace),
    () => recordMap.off('moveend', sizeRecordPlace),
  );
}

/**
 * Show an expanded record's dot from the zoom where its cell is wide enough on screen to hold it, and an
 * obscured record's square from RECORD_MIN_ZOOM; either from the zoom where the grid turns finer than the
 * selected cell if sooner: mid-gesture, before the new cells load.
 */
function sizeRecordPlace() {
  if (!map?.getLayer(RECORD_DOT_LAYER)) return;
  const xs = $hexGeometry.get()?.ring.map((position) => map!.project(position).x);
  const cellWidth = xs ? Math.max(...xs) - Math.min(...xs) : null;
  const finerMinZoom = cellWidth === null ? Infinity : gridFinerZoom();
  const maxZoom = map.getMaxZoom() + 1;
  map.setLayerZoomRange(RECORD_DOT_LAYER, Math.min(recordDotMinZoom(map.getZoom(), cellWidth), finerMinZoom), maxZoom);
  for (const layer of RECORD_AREA_LAYERS)
    map.setLayerZoomRange(layer, Math.min(RECORD_MIN_ZOOM, finerMinZoom), maxZoom);
}

/** The zoom where the grid at the map's latitude turns finer than the selected cell; Infinity if never or unknown. */
function gridFinerZoom(): number {
  const selectedLevel = $selectedHex.get()?.[2];
  const layer = occurrenceLayer();
  if (!map || !layer || selectedLevel === undefined) return Infinity;
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
  hexSource = createHexSource(hexSourceOptions(map));
  cleanups.push(() => hexSource?.destroy());
  listenForHexSource(map);
  decorateMap(maplibre, element);
  listenToMap();
  listenToStores();
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
    <div ref="container" class="size-full" role="region" aria-label="Occurrence map"></div>
    <div class="crosshair" aria-hidden="true"></div>
    <div
      v-if="tooltip"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] rounded-sm bg-surface px-2 py-1 text-xs text-text shadow-panel"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      {{ tooltip.text }}
    </div>
    <WebglNotice v-if="unsupported" />
    <p
      v-else-if="failed"
      class="absolute left-1/2 top-[calc(var(--header-offset)+0.75rem)] -translate-x-1/2 rounded-md bg-surface px-3 py-2 text-xs text-muted shadow-panel"
    >
      Occurrence tiles are unavailable right now. The basemap still works.
    </p>
    <p
      v-else-if="hexState.kind !== 'gbif'"
      role="status"
      class="absolute left-1/2 top-[calc(var(--header-offset)+0.75rem)] -translate-x-1/2 rounded-md bg-surface px-3 py-2 text-xs text-muted shadow-panel"
    >
      <template v-if="hexState.kind === 'cubes'">
        Sample cube data: counts estimated from {{ samplePercent }} of GBIF's records.
      </template>
      <template v-else>The sample cubes couldn't be read, so the map is using GBIF.</template>
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

/* Expanded attribution must sit above the records-per-year dock, or it's hidden on mobile.
   The overlay is one stacking context, so only lift it while no panel or flyout is open. */
.app-shell:has(.bottom-dock):not(:has(.side-panel, .bottom-sheet, #filter-flyout))
  .map-canvas
  .maplibregl-ctrl-bottom-right:has(.maplibregl-compact-show) {
  z-index: 20;
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
