/**
 * The map's MapLibre style: a basemap with our data drawn over it. Pure
 * functions of their inputs (theme colours, hex cells, GeoJSON), so the
 * MapCanvas island only gathers inputs and wires events.
 */
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LayerSpecification,
  MapGeoJSONFeature,
  StyleSpecification,
} from 'maplibre-gl';
import { BASEMAPS, plainStyleUrl, type BasemapId, type RasterDef, type Theme } from '~/lib/basemaps';
import { polygonToWkt } from '~/lib/gbif';
import { circleRing } from '~/lib/gbif/params';
import { rampColors, thresholdsAt } from '~/lib/ramp';
import type { HexGeometry } from '~/stores/explorer';

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Zoomed out further, a record's area (or, outside a cell, its dot) says little more than its cell outline. */
export const RECORD_MIN_ZOOM = 7;
export const RECORD_DOT_LAYER = 'selected-record';
/** The obscured record's square: its fill and dashed edge. */
export const RECORD_AREA_LAYERS = ['record-area', 'record-edge'] as const;
const RECORD_DOT_RADIUS_PX = 6;
const RECORD_DOT_STROKE_PX = 3;
const RECORD_DOT_DIAMETER_PX = 2 * (RECORD_DOT_RADIUS_PX + RECORD_DOT_STROKE_PX);
/** The dot shows once its cell is this many dots wide on screen; narrower, the dot would all but cover the cell. */
const CELL_WIDTH_IN_DOTS = 3;
/** MapLibre's highest layer zoom. */
const LAYER_MAX_ZOOM = 24;
/** Marks the record's feature in the `selected` source, so its area isn't drawn as the cell outline. */
const RECORD_PART = 'record';
const IS_RECORD_AREA: ExpressionSpecification = [
  'all',
  ['==', ['geometry-type'], 'Polygon'],
  ['==', ['get', 'part'], RECORD_PART],
];
/** Glyphs for raster basemaps, which bring none of their own. */
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** The hexes' opacity at a zoom: a touch more see-through closer in, where the basemap matters more. */
export function occOpacity(zoom: number): number {
  return 0.78 - 0.12 * Math.min(1, Math.max(0, zoom / 8));
}

/** Theme colours from the CSS custom properties. */
export interface MapColors {
  accent: string;
  accentContrast: string;
  bg: string;
  /** The plain basemap's land fill. */
  land: string;
  text: string;
}

/** What our sources start with when the style is (re)built. */
export interface OverlayData {
  /** Occurrence hex cells (lib/map/occLayer.ts). */
  hexes: GeoJSON.FeatureCollection;
  /** Their grid level, which the colour bins follow. */
  level: number;
  selected: GeoJSON.FeatureCollection;
  near: GeoJSON.FeatureCollection;
}

/** Log bins for cells at this grid level (see lib/ramp.ts); matches the legend. */
export function fillColor(level: number): ExpressionSpecification {
  const colors = rampColors();
  const step: unknown[] = ['step', ['get', 'total'], colors[0]];
  thresholdsAt(level).forEach((threshold, index) => step.push(threshold, colors[index + 1]));
  return step as ExpressionSpecification;
}

/** Our data sources, shared by every basemap. */
function overlaySources(data: OverlayData): StyleSpecification['sources'] {
  return {
    occ: {
      type: 'geojson',
      data: data.hexes,
      // Cell ids, so arriving tiles update the source instead of replacing it.
      promoteId: 'id',
      attribution: 'Occurrence data © <a href="https://www.gbif.org">GBIF.org</a> and data publishers',
    },
    hover: { type: 'geojson', data: EMPTY },
    selected: { type: 'geojson', data: data.selected },
    near: { type: 'geojson', data: data.near },
  };
}

/** The occurrence layer, drawn below basemap labels. */
function dataLayers(level: number): LayerSpecification[] {
  return [
    {
      id: 'occ-fill',
      type: 'fill',
      source: 'occ',
      paint: {
        'fill-color': fillColor(level),
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, occOpacity(0), 8, occOpacity(8)],
        'fill-antialias': true,
      },
    },
  ];
}

/**
 * The expanded record: a ring, not a filled dot, so it never reads as the near-me pin; an obscured
 * record's square is dashed like the near-me circle, as both mean "somewhere in here".
 */
function recordLayers(accent: string, bg: string): LayerSpecification[] {
  const base = { source: 'selected', minzoom: RECORD_MIN_ZOOM } as const;
  return [
    {
      ...base,
      id: RECORD_AREA_LAYERS[0],
      type: 'fill',
      filter: IS_RECORD_AREA,
      paint: { 'fill-color': accent, 'fill-opacity': 0.12 },
    },
    {
      ...base,
      id: RECORD_AREA_LAYERS[1],
      type: 'line',
      filter: IS_RECORD_AREA,
      paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [3, 2] },
    },
    {
      ...base,
      id: RECORD_DOT_LAYER,
      type: 'circle',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': bg,
        'circle-radius': RECORD_DOT_RADIUS_PX,
        'circle-stroke-color': accent,
        'circle-stroke-width': RECORD_DOT_STROKE_PX,
      },
    },
  ];
}

/**
 * The zoom from which an expanded record's dot shows: once its cell is wide enough on screen for the dot
 * to say where in the cell the record is.
 * @param zoom The map's zoom now.
 * @param cellWidthPx The cell's width on screen now, or null for a record listed outside a cell (near me).
 */
export function recordDotMinZoom(zoom: number, cellWidthPx: number | null): number {
  if (cellWidthPx === null) return RECORD_MIN_ZOOM;
  const zoomIn = Math.log2((CELL_WIDTH_IN_DOTS * RECORD_DOT_DIAMETER_PX) / cellWidthPx);
  return Math.min(LAYER_MAX_ZOOM, zoom + zoomIn);
}

/** Hover, selection and "near me" layers, drawn above everything. */
function topLayers({ accent, bg, text }: MapColors): LayerSpecification[] {
  return [
    { id: 'hover-line', type: 'line', source: 'hover', paint: { 'line-color': text, 'line-width': 1.5 } },
    {
      id: 'selected-line',
      type: 'line',
      source: 'selected',
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['!=', ['get', 'part'], RECORD_PART]],
      paint: { 'line-color': accent, 'line-width': 3 },
    },
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
    ...recordLayers(accent, bg),
  ];
}

/** Our data sources and layers, shared by every basemap. */
export function overlay(
  colors: MapColors,
  data: OverlayData,
): {
  sources: StyleSpecification['sources'];
  data: LayerSpecification[];
  top: LayerSpecification[];
} {
  return { sources: overlaySources(data), data: dataLayers(data.level), top: topLayers(colors) };
}

const styleCache = new Map<string, Promise<StyleSpecification | null>>();

/** Fetch (once) a vector basemap style; null if it cannot be loaded. */
export function fetchStyle(url: string): Promise<StyleSpecification | null> {
  let pending = styleCache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => (response.ok ? (response.json() as Promise<StyleSpecification>) : null))
      .catch(() => null);
    styleCache.set(url, pending);
  }
  return pending;
}

/** Roads, rivers and the like, which show through the semi-transparent hexes and so are kept for close zooms. */
const DETAIL_LINE_LAYER = /waterway|highway|road|railway|aeroway/;
const DETAIL_LINE_MIN_ZOOM = 8;
/** Below this zoom only country and continent names are shown, to keep the data readable. */
const LABEL_MIN_ZOOM = 5;
const MAJOR_LABEL_LAYER = /country|continent/;

/** Dark-style fills drawn near-black to match its background, which would show as holes on lifted land. */
const DARK_LAND_FILL_LAYER = /ice_shelf|glacier|residential|pier/;

/** On the dark style, land fills take the land colour and water sinks to the page background, so land reads lighter. */
function themeDarkFill(layer: FillLayerSpecification, { bg, land }: MapColors): LayerSpecification {
  if (layer.id === 'water') return { ...layer, paint: { ...layer.paint, 'fill-color': bg } };
  if (DARK_LAND_FILL_LAYER.test(layer.id)) return { ...layer, paint: { ...layer.paint, 'fill-color': land } };
  return layer;
}

/** Restyles one basemap layer for the app's theme: flat land, quieter details, haloed labels. */
function themeBasemapLayer(layer: LayerSpecification, colors: MapColors, theme: Theme): LayerSpecification {
  const { bg, land, text } = colors;
  if (layer.type === 'background') return { ...layer, paint: { ...layer.paint, 'background-color': land } };
  if (theme === 'dark' && layer.type === 'fill') return themeDarkFill(layer, colors);
  if (layer.type === 'line' && DETAIL_LINE_LAYER.test(layer.id)) {
    return { ...layer, minzoom: Math.max(layer.minzoom ?? 0, DETAIL_LINE_MIN_ZOOM) };
  }
  if (layer.type === 'symbol') {
    const isMajor = MAJOR_LABEL_LAYER.test(layer.id);
    return {
      ...layer,
      ...(!isMajor && { minzoom: Math.max(layer.minzoom ?? 0, LABEL_MIN_ZOOM) }),
      // Labels sit on top of the data, so give them theme colours and a halo.
      paint: { ...layer.paint, 'text-color': text, 'text-halo-color': bg, 'text-halo-width': 1.4, 'text-opacity': 0.9 },
    };
  }
  return layer;
}

/** Globe projection with a sky that melts into the page background. */
function globeSettings(bg: string): Pick<StyleSpecification, 'projection' | 'sky'> {
  return {
    projection: { type: 'globe' },
    sky: {
      'sky-color': bg,
      'horizon-color': bg,
      'fog-color': bg,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 0.2, 7, 0],
    },
  };
}

/** The loaded vector style with our data above all its non-label layers, and its labels and our selections on top. */
function spliceOverlay(
  base: StyleSpecification,
  colors: MapColors,
  data: OverlayData,
  theme: Theme,
): StyleSpecification {
  const ours = overlay(colors, data);
  const layers = base.layers.map((layer) => themeBasemapLayer(layer, colors, theme));
  // Not a cut at the first label: OpenFreeMap's dark style puts water names before its roads and buildings.
  const shapes = layers.filter((layer) => layer.type !== 'symbol');
  const labels = layers.filter((layer) => layer.type === 'symbol');
  return {
    ...base,
    ...globeSettings(colors.bg),
    sources: { ...base.sources, ...ours.sources },
    layers: [...shapes, ...ours.data, ...labels, ...ours.top],
  };
}

/** The raster basemap as a style source. */
function rasterSource(raster: RasterDef): StyleSpecification['sources'][string] {
  const { tiles, tileSize, maxzoom, attribution } = raster;
  return { type: 'raster', tiles, tileSize, maxzoom, attribution };
}

const RASTER_LAYER: LayerSpecification = {
  id: 'base',
  type: 'raster',
  source: 'base',
  paint: { 'raster-opacity': 0.9 },
};

/** A plain background (under a raster basemap, if there is one) with our layers on top. */
function plainStyle(raster: RasterDef | null, colors: MapColors, data: OverlayData): StyleSpecification {
  const ours = overlay(colors, data);
  return {
    version: 8,
    glyphs: GLYPHS,
    ...globeSettings(colors.bg),
    sources: { ...(raster && { base: rasterSource(raster) }), ...ours.sources },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': colors.bg } },
      ...(raster ? [RASTER_LAYER] : []),
      ...ours.data,
      ...ours.top,
    ],
  };
}

/** A vector style cut down to its background and labels, with the raster basemap between them. */
function rasterUnderLabels(base: StyleSpecification, raster: RasterDef): StyleSpecification {
  const backgrounds = base.layers.filter((layer) => layer.type === 'background');
  const labels = base.layers.filter((layer) => layer.type === 'symbol');
  return {
    ...base,
    sources: { ...base.sources, base: rasterSource(raster) },
    layers: [...backgrounds, RASTER_LAYER, ...labels],
  };
}

/**
 * The basemap's own style with our layers spliced in (data below its labels,
 * selections above everything). Raster basemaps get the plain style's labels
 * on top; without a loadable vector style, labels are left out.
 * @param loadStyle Fetches a vector style by URL; overridable for tests.
 */
export async function buildStyle(
  basemap: BasemapId,
  theme: Theme,
  colors: MapColors,
  data: OverlayData,
  loadStyle: (url: string) => Promise<StyleSpecification | null> = fetchStyle,
): Promise<StyleSpecification> {
  const source = BASEMAPS[basemap].source(theme);
  if (source.kind === 'vector') {
    const base = await loadStyle(source.styleUrl);
    return base ? spliceOverlay(base, colors, data, theme) : plainStyle(null, colors, data);
  }
  // Raster basemaps borrow the plain map's labels, so place names read the same on both.
  const labels = await loadStyle(plainStyleUrl(theme));
  return labels
    ? spliceOverlay(rasterUnderLabels(labels, source), colors, data, theme)
    : plainStyle(source, colors, data);
}

/** Pin and radius circle for "near me". */
export function nearGeoJson(at: { lat: number; lng: number } | null, radiusKm: number): GeoJSON.FeatureCollection {
  if (!at) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [circleRing(at.lat, at.lng, radiusKm)] },
      },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [at.lng, at.lat] } },
    ],
  };
}

/** Outline of the selected cell, and the place of the record expanded in its list (lib/map/recordPlace.ts). */
export function selectedGeoJson(
  geometry: HexGeometry | null,
  record: GeoJSON.Point | GeoJSON.Polygon | null = null,
): GeoJSON.FeatureCollection {
  if (!geometry && !record) return EMPTY;
  const features: GeoJSON.Feature[] = [];
  if (geometry)
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [geometry.ring] } });
  if (record) features.push({ type: 'Feature', properties: { part: RECORD_PART }, geometry: record });
  return { type: 'FeatureCollection', features };
}

type HexFeature = Pick<MapGeoJSONFeature, 'geometry' | 'properties'>;

/** Each feature's geometry, built once: the map asks it of every drawn cell on every draw once one is known empty. */
const geometries = new WeakMap<HexFeature, HexGeometry | null>();

/** A hex feature's outer ring, WKT and tile count, or null if it has no usable ring; the feature must not change after. */
export function geometryOf(feature: HexFeature): HexGeometry | null {
  if (!geometries.has(feature)) geometries.set(feature, buildGeometry(feature));
  return geometries.get(feature)!;
}

function buildGeometry(feature: HexFeature): HexGeometry | null {
  const geometry = feature.geometry;
  const ring =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0]?.[0]
        : undefined;
  if (!ring || ring.length < 4) return null;
  const points = ring.map((position) => [position[0] as number, position[1] as number] as [number, number]);
  return { ring: points, wkt: polygonToWkt(points), tileTotal: Number(feature.properties['total'] ?? 0) };
}
