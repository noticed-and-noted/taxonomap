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
import { compact, full } from '~/lib/format';
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
import { needsAdhoc } from '~/lib/gbif';
import { checkCells, createHoverCounter, knownCount } from '~/lib/map/cellCounts';
import { hexCentre, type Hex } from '~/lib/map/occGrid';
import { createOccLayer, type OccLayer, type OccLayerOptions } from '~/lib/map/occLayer';
import { $nearAt, $nearRadius, setNearLocation } from '~/stores/near';
import { $ramp } from '~/stores/ramp';
import { prefersReducedMotion } from '~/stores/reading';
import type { ScreenBox } from '~/lib/tour';
import { PIN_CURSOR } from './pinCursors';
import WebglNotice from './WebglNotice.vue';
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
  clearHexSelection,
  sameView,
  type FlyRequest,
} from '~/stores/explorer';

const container = ref<HTMLDivElement>();
const failed = ref(false);
const unsupported = useStore($mapUnsupported);
const tooltip = ref<{ x: number; y: number; text: string; wkt: string } | null>(null);

let map: MlMap | undefined;
let occ: OccLayer | undefined;
const cleanups: (() => void)[] = [];
let pendingHexRestore = false;

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
  if (prefersReducedMotion()) {
    void src.updateData({ add });
    return;
  }
  const activeMap = map;
  fresh = add;
  fade++;
  setData('occ-fresh', { type: 'FeatureCollection', features: add });
  activeMap.setPaintProperty('occ-fresh-fill', 'fill-opacity-transition', { duration: 0, delay: 0 });
  activeMap.setPaintProperty('occ-fresh-fill', 'fill-opacity', 0);
  requestAnimationFrame(() => {
    activeMap.setPaintProperty('occ-fresh-fill', 'fill-opacity-transition', { duration: FADE_MS, delay: 0 });
    activeMap.setPaintProperty('occ-fresh-fill', 'fill-opacity', occOpacity(activeMap.getZoom()));
  });
  fadeTimer = setTimeout(settleFresh, FADE_MS + 20);
}

/** A whole new set of cells (new level or filters): no fade, nothing left mid-fade. */
function replaceHexes(collection: GeoJSON.FeatureCollection) {
  clearTimeout(fadeTimer);
  fresh = [];
  fade++;
  setData('occ-fresh', EMPTY);
  setData('occ', collection);
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
  setData('near', nearData());
}

function styleFor() {
  return buildStyle($basemap.get(), theme(), colors(), {
    hexes: occ?.collection() ?? EMPTY,
    level: $gridLevel.get(),
    selected: selectedGeoJson($hexGeometry.get()),
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
  if (!map || !occ || offGlobe(point)) return undefined;
  const lngLat = map.unproject([point.x, point.y]);
  return occ.cellAt([lngLat.lng, lngLat.lat]);
}

function selectAt(point: { x: number; y: number }, lngLat: { lng: number; lat: number }) {
  const feature = hexAt(point);
  const geometry = feature && geometryOf(feature);
  if (!geometry) {
    clearHexSelection();
    return;
  }
  $hexGeometry.set(geometry);
  $selectedHex.set([Number(lngLat.lng.toFixed(4)), Number(lngLat.lat.toFixed(4))]);
  $panel.set('hex');
}

/** Re-resolve a hex selected via the URL once its cell is loaded. */
function restoreHex() {
  const selected = $selectedHex.get();
  if (!occ || !selected || $hexGeometry.get()) {
    pendingHexRestore = false;
    return;
  }
  const feature = occ.cellAt([selected[0], selected[1]]);
  const geometry = feature && geometryOf(feature);
  if (geometry) {
    $hexGeometry.set(geometry);
    if ($panel.get() === 'none') $panel.set('hex');
  }
  pendingHexRestore = false;
}

/** Room kept between the tour's hex and the map's covered edges, so its tip and the legend never hide it. */
const BUSIEST_MARGIN = 120;
/** The same with the bottom sheet, which leaves a short band of map; the tip moves itself off the hex there. */
const SHEET_MARGIN = 40;

/** cos of the widest angle from the map's centre a tour hex may sit at (60°), so it faces the viewer on the globe. */
const FACING_COS = 0.5;

/** Whether a point is within FACING_COS of the map's centre, by great-circle angle. */
function isFacing([lng, lat]: [number, number]): boolean {
  const centre = map!.getCenter();
  const radians = Math.PI / 180;
  const cosAngle =
    Math.sin(lat * radians) * Math.sin(centre.lat * radians) +
    Math.cos(lat * radians) * Math.cos(centre.lat * radians) * Math.cos((lng - centre.lng) * radians);
  return cosAngle > FACING_COS;
}

/** The bottom sheet's height when it opens (BottomSheet's half snap), as a share of the page. */
const SHEET_OPEN_SHARE = 0.55;
/** The side panel's inset from the map's right edge (right-3). */
const PANEL_INSET = 12;

/** The covered edges, plus a margin, once the cell panel is open too, since the tour opens it on the hex it picks. */
function coveredWithPanel(box: DOMRect) {
  const covered = coveredEdges();
  if (window.matchMedia('(min-width: 768px)').matches) {
    const panelWidth = parseFloat(css('--panel-width', '400px'));
    return { ...covered, right: Math.max(covered.right, panelWidth + PANEL_INSET), margin: BUSIEST_MARGIN };
  }
  return { ...covered, bottom: Math.max(covered.bottom, box.height * SHEET_OPEN_SHARE), margin: SHEET_MARGIN };
}

/** The loaded cell with the most records that faces the viewer, clear of the floating chrome and the cell panel. */
function busiestInView(): Hex | undefined {
  if (!map || !occ) return undefined;
  const box = map.getContainer().getBoundingClientRect();
  const covered = coveredWithPanel(box);
  let busiest: Hex | undefined;
  for (const hex of occ.collection().features as Hex[]) {
    const centre = hexCentre(hex);
    const point = map.project(centre);
    const isClear =
      point.x > covered.left + covered.margin &&
      point.x < box.width - covered.right - covered.margin &&
      point.y > covered.top + covered.margin &&
      point.y < box.height - covered.bottom - covered.margin;
    if (isClear && isFacing(centre) && hex.properties.total > (busiest?.properties.total ?? 0)) busiest = hex;
  }
  return busiest;
}

/** The outline of the hex the tour or a hint points at, kept so its box can follow the map. */
let pointedRing: [number, number][] | null = null;

/** Tour and hints: find the busiest hex in view, select it if asked (panel closed), and publish where it is. */
function findBusiestHex(shouldSelect: boolean) {
  const hex = busiestInView();
  const geometry = hex && geometryOf(hex);
  pointedRing = geometry ? geometry.ring : null;
  if (hex && geometry && shouldSelect) {
    const [lng, lat] = hexCentre(hex);
    $hexGeometry.set(geometry);
    $selectedHex.set([Number(lng.toFixed(4)), Number(lat.toFixed(4))]);
  }
  $busiestHexBox.set(pointedBox());
}

/** The pointed-at hex's box on screen, in viewport px. */
function pointedBox(): ScreenBox | null {
  if (!map || !pointedRing) return null;
  const box = map.getContainer().getBoundingClientRect();
  const points = pointedRing.map((position) => map!.project(position));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left: box.left + left, top: box.top + top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** Keep the tour's or hint's hex box on its hex as the map moves or resizes. */
function followBusiestHex() {
  if ($busiestHexBox.get()) $busiestHexBox.set(pointedBox());
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

/** Breathing room between a fitted area and the map's edges, in px. */
const FIT_PADDING = 60;
const FIT_MAX_ZOOM = 9;
const FIT_DURATION_MS = 1200;
const FLIGHT_DURATION_MS = 1400;

/** Fit a box clear of the floating chrome, or fly to a chosen centre at the zoom that fits it. */
function flyToBounds(request: Extract<FlyRequest, { kind: 'bounds' }>) {
  if (!map) return;
  const covered = coveredEdges();
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
  const covered = coveredEdges();
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
    occ?.redraw();
  } else if (tooltip.value?.wkt === wkt) tooltip.value = { ...tooltip.value, text: records(count, full(count)) };
});

/** A cell whose exact count is known to be 0. */
function knownEmpty(hex: Hex): boolean {
  const geometry = geometryOf(hex);
  return !!geometry && knownCount($occurrenceFilter.get(), geometry.wkt) === 0;
}

/** Estimates at or below this are checked for empty cells. */
const SPARSE_MAX = 3;
/** Most cells checked per draw. */
const MAX_CHECKS = 40;

/**
 * Adhoc tiles snap records to a coarse grid (lib/map/occGrid.ts), so a record
 * near an edge can make a neighbouring cell that holds none. Check low
 * estimates and drop the cells that come back empty.
 * shortcut: only estimates ≤ SPARSE_MAX, at most MAX_CHECKS per draw; a larger phantom cell goes when hovered.
 */
function checkSparse(hexes: Hex[]) {
  const filter = $occurrenceFilter.get();
  const bounds = $mapBounds.get();
  if (!needsAdhoc(filter) || !bounds) return;
  const inView = (hex: Hex) => {
    const [lng, lat] = hex.geometry.coordinates[0]![0]!;
    return lng! >= bounds[0] && lng! <= bounds[2] && lat! >= bounds[1] && lat! <= bounds[3];
  };
  const wkts = hexes
    .filter((candidate) => candidate.properties.total <= SPARSE_MAX && inView(candidate))
    .slice(0, MAX_CHECKS)
    .flatMap((hex) => geometryOf(hex)?.wkt ?? []);
  checkCells(filter, wkts).then(
    (hasEmpty) => hasEmpty && filter === $occurrenceFilter.get() && occ?.redraw(),
    () => undefined, // The estimates stay up.
  );
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

/** Whether a restore of a URL-selected hex is due: asked for, or selected without a resolved cell. */
function restoreHexIfDue() {
  if (pendingHexRestore || ($selectedHex.get() && !$hexGeometry.get())) restoreHex();
}

/** How the occurrence layer reads the filter and reports cells, level, progress and failure. */
function occLayerOptions(): OccLayerOptions {
  return {
    filter: () => $occurrenceFilter.get(),
    listenFilter: (onChange) => $occurrenceFilter.listen(onChange),
    isEmpty: knownEmpty,
    onCells: (cells) => {
      replaceHexes(cells);
      checkSparse(cells.features as Hex[]);
      restoreHexIfDue();
    },
    onChanges: (add, remove) => {
      changeHexes(add, remove);
      checkSparse(add);
      restoreHexIfDue();
    },
    onLevel: (level) => {
      $gridLevel.set(level);
      paintHexes(level);
    },
    onProgress: (done, total) => $mapLoad.set({ loading: done < total, done, total }),
    onFailed: () => (failed.value = true),
  };
}

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

/** Store → map: view, basemap, ramp, selection, mode, "near me" and fly requests. */
function listenToStores() {
  cleanups.push(
    // Cells drawn off-screen are checked once they come into view.
    $mapBounds.listen(() => checkSparse((occ?.collection().features ?? []) as Hex[])),
    $basemap.listen(() => void rebuildStyle()),
    // A new density ramp only repaints the hexes.
    $ramp.listen(() => paintHexes()),
    $mapView.listen((view) => {
      if (!map) return;
      const center = map.getCenter();
      if (!sameView(view, { lng: center.lng, lat: center.lat, zoom: map.getZoom() }))
        map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });
    }),
    $hexGeometry.subscribe((geometry) => setData('selected', selectedGeoJson(geometry))),
    $selectedHex.listen((selected) => {
      if (!selected) $hexGeometry.set(null);
      else if (!$hexGeometry.get()) pendingHexRestore = true;
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
    $busiestHexRequest.subscribe((request) => {
      if (!request) return;
      $busiestHexRequest.set(null);
      findBusiestHex(request === 'select');
    }),
  );
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
  const style = await styleFor();
  const element = container.value;
  if (!element) return;
  map = new maplibre.Map({
    container: element,
    style,
    center: [view.lng, view.lat],
    zoom: view.zoom,
    attributionControl: { compact: true },
    maxPitch: 0,
    dragRotate: false,
    renderWorldCopies: false,
    fadeDuration: prefersReducedMotion() ? 0 : MAP_FADE_MS,
  });
  occ = createOccLayer(map, occLayerOptions());
  cleanups.push(() => occ?.destroy());
  decorateMap(maplibre, element);
  listenToMap();
  listenToStores();
  listenToPage();
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
