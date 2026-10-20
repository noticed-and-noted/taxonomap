/**
 * The map's MapLibre style: a basemap with our data drawn over it. Pure
 * functions of their inputs (theme colours, hex cells, GeoJSON), so the
 * MapCanvas island only gathers inputs and wires events.
 */
import type { ExpressionSpecification, LayerSpecification, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import { BASEMAPS, type BasemapId, type RasterDef, type Theme } from '~/lib/basemaps';
import { polygonToWkt } from '~/lib/gbif';
import { circleRing } from '~/lib/gbif/params';
import { rampColors, thresholdsAt } from '~/lib/ramp';
import type { HexGeometry } from '~/stores/explorer';

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
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
    // Cells fading in, before they join `occ`.
    'occ-fresh': { type: 'geojson', data: EMPTY },
    hover: { type: 'geojson', data: EMPTY },
    selected: { type: 'geojson', data: data.selected },
    near: { type: 'geojson', data: data.near },
  };
}

/** The occurrence layers, drawn below basemap labels. */
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
    {
      id: 'occ-fresh-fill',
      type: 'fill',
      source: 'occ-fresh',
      paint: {
        'fill-color': fillColor(level),
        // Animated from 0 to occOpacity as cells arrive.
        'fill-opacity': 0,
        'fill-opacity-transition': { duration: 0, delay: 0 },
        'fill-antialias': true,
      },
    },
  ];
}

/** Hover, selection and "near me" layers, drawn above everything. */
function topLayers({ accent, bg, text }: MapColors): LayerSpecification[] {
  return [
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

/** Restyles one basemap layer for the app's theme: flat background, quieter details, haloed labels. */
function themeBasemapLayer(layer: LayerSpecification, { bg, text }: MapColors): LayerSpecification {
  if (layer.type === 'background') return { ...layer, paint: { ...layer.paint, 'background-color': bg } };
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

/** The loaded vector style with our layers inserted below its first label layer and the rest above. */
function spliceOverlay(base: StyleSpecification, colors: MapColors, data: OverlayData): StyleSpecification {
  const ours = overlay(colors, data);
  const firstSymbol = base.layers.findIndex((layer) => layer.type === 'symbol');
  const cut = firstSymbol === -1 ? base.layers.length : firstSymbol;
  const layers = base.layers.map((layer) => themeBasemapLayer(layer, colors));
  return {
    ...base,
    ...globeSettings(colors.bg),
    sources: { ...base.sources, ...ours.sources },
    layers: [...layers.slice(0, cut), ...ours.data, ...layers.slice(cut), ...ours.top],
  };
}

/** A plain background (under a raster basemap, if there is one) with our layers on top. */
function plainStyle(raster: RasterDef | null, colors: MapColors, data: OverlayData): StyleSpecification {
  const ours = overlay(colors, data);
  return {
    version: 8,
    glyphs: GLYPHS,
    ...globeSettings(colors.bg),
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
      { id: 'background', type: 'background', paint: { 'background-color': colors.bg } },
      ...(raster ? [{ id: 'base', type: 'raster' as const, source: 'base', paint: { 'raster-opacity': 0.9 } }] : []),
      ...ours.data,
      ...ours.top,
    ],
  };
}

/**
 * The basemap's own style with our layers spliced in (data below its labels,
 * selections above everything), or a plain/raster style when the basemap is
 * raster or its vector style cannot be loaded.
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
  const base = source.kind === 'vector' ? await loadStyle(source.styleUrl) : null;
  if (base) return spliceOverlay(base, colors, data);
  return plainStyle(source.kind === 'raster' ? source : null, colors, data);
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

/** Outline of the selected cell. */
export function selectedGeoJson(geometry: HexGeometry | null): GeoJSON.FeatureCollection {
  if (!geometry) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [geometry.ring] } }],
  };
}

/** A hex feature's outer ring, WKT and tile count, or null if it has no usable ring. */
export function geometryOf(feature: Pick<MapGeoJSONFeature, 'geometry' | 'properties'>): HexGeometry | null {
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
