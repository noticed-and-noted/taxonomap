/**
 * The map's MapLibre style: a basemap with our data drawn over it. Pure
 * functions of their inputs (theme colours, hex cells, GeoJSON), so the
 * MapCanvas island only gathers inputs and wires events.
 */
import type { ExpressionSpecification, LayerSpecification, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import { BASEMAPS, type BasemapId, type Theme } from '~/lib/basemaps';
import { polygonToWkt } from '~/lib/gbif';
import { circleRing } from '~/lib/gbif/params';
import { rampColors, thresholdsAt } from '~/lib/ramp';
import type { HexGeometry } from '~/stores/explorer';

export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Glyphs for raster basemaps, which bring none of their own. */
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** The occurrence hex layer, which clicks and hovers query. */
export const OCC_LAYERS = ['occ-fill'];

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
  const c = rampColors();
  const step: unknown[] = ['step', ['get', 'total'], c[0]];
  thresholdsAt(level).forEach((t, i) => step.push(t, c[i + 1]));
  return step as ExpressionSpecification;
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
  const { accent, bg, text } = colors;
  return {
    sources: {
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
    },
    // Drawn below basemap labels.
    data: [
      {
        id: 'occ-fill',
        type: 'fill',
        source: 'occ',
        paint: {
          'fill-color': fillColor(data.level),
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, occOpacity(0), 8, occOpacity(8)],
          'fill-antialias': true,
        },
      },
      {
        id: 'occ-fresh-fill',
        type: 'fill',
        source: 'occ-fresh',
        paint: {
          'fill-color': fillColor(data.level),
          // Animated from 0 to occOpacity as cells arrive.
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: 0, delay: 0 },
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
    ],
  };
}

const styleCache = new Map<string, Promise<StyleSpecification | null>>();

/** Fetch (once) a vector basemap style; null if it cannot be loaded. */
export function fetchStyle(url: string): Promise<StyleSpecification | null> {
  let p = styleCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : null))
      .catch(() => null);
    styleCache.set(url, p);
  }
  return p;
}

/**
 * The basemap's own style with our layers spliced in (data below its labels,
 * selections above everything), or a plain/raster style when the basemap is
 * raster or its vector style cannot be loaded.
 */
export async function buildStyle(
  basemap: BasemapId,
  theme: Theme,
  colors: MapColors,
  data: OverlayData,
  loadStyle: (url: string) => Promise<StyleSpecification | null> = fetchStyle,
): Promise<StyleSpecification> {
  const { bg, text } = colors;
  const src = BASEMAPS[basemap].source(theme);
  const ours = overlay(colors, data);
  const globe: Pick<StyleSpecification, 'projection' | 'sky'> = {
    projection: { type: 'globe' },
    sky: {
      'sky-color': bg,
      'horizon-color': bg,
      'fog-color': bg,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 0.2, 7, 0],
    },
  };

  const base = src.kind === 'vector' ? await loadStyle(src.styleUrl) : null;
  if (base) {
    // Insert the data below the first label layer so place names stay legible.
    const firstSymbol = base.layers.findIndex((l) => l.type === 'symbol');
    const cut = firstSymbol === -1 ? base.layers.length : firstSymbol;
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
export function selectedGeoJson(g: HexGeometry | null): GeoJSON.FeatureCollection {
  if (!g) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [g.ring] } }],
  };
}

/** A hex feature's outer ring, WKT and tile count, or null if it has no usable ring. */
export function geometryOf(f: Pick<MapGeoJSONFeature, 'geometry' | 'properties'>): HexGeometry | null {
  const g = f.geometry;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : undefined;
  if (!ring || ring.length < 4) return null;
  const r = ring.map((p) => [p[0] as number, p[1] as number] as [number, number]);
  return { ring: r, wkt: polygonToWkt(r), tileTotal: Number(f.properties['total'] ?? 0) };
}
