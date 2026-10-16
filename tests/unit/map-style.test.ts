/** The map's style: our layers spliced into each kind of basemap, and the GeoJSON helpers. */
import type { MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import { buildStyle, EMPTY, fillColor, geometryOf, nearGeoJson, selectedGeoJson } from '~/lib/map/style';
import { thresholdsAt } from '~/lib/ramp';

const COLORS = { accent: '#a', accentContrast: '#c', bg: '#b', text: '#t' };
const HEXES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: '3:0,0', total: 4 }, geometry: { type: 'Point', coordinates: [0, 0] } },
  ],
};
const DATA = { hexes: HEXES, level: 6, selected: EMPTY, records: EMPTY, near: EMPTY };

const vectorBase: StyleSpecification = {
  version: 8,
  sources: { omt: { type: 'vector', url: 'https://base.test' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'road_major', type: 'line', source: 'omt', 'source-layer': 'transportation' },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water' },
    { id: 'place_city', type: 'symbol', source: 'omt', 'source-layer': 'place' },
    { id: 'place_country', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 1 },
  ],
};

const ids = (s: StyleSpecification) => s.layers.map((l) => l.id);
const layer = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as Record<string, unknown>;

describe('buildStyle', () => {
  it('puts the data under the basemap labels and selections on top', async () => {
    const s = await buildStyle('plain', 'dark', COLORS, DATA, async () => vectorBase);
    expect(ids(s)).toEqual([
      'background',
      'road_major',
      'water',
      'occ-fill',
      'occ-fresh-fill',
      'place_city',
      'place_country',
      'hover-line',
      'selected-line',
      'near-area',
      'near-edge',
      'near-pin',
      'record-clusters',
      'record-count',
      'record-points',
    ]);
    expect(Object.keys(s.sources)).toEqual(['omt', 'occ', 'occ-fresh', 'hover', 'selected', 'records', 'near']);
    // Cell ids let arriving tiles update the hexes in place.
    expect(s.sources['occ']).toMatchObject({ promoteId: 'id' });
    expect(s.projection).toEqual({ type: 'globe' });
  });

  it('themes the basemap: background, label colours, and roads and minor labels only up close', async () => {
    const s = await buildStyle('plain', 'dark', COLORS, DATA, async () => vectorBase);
    expect(layer(s, 'background')['paint']).toEqual({ 'background-color': '#b' });
    expect(layer(s, 'road_major')['minzoom']).toBe(8);
    expect(layer(s, 'water')['minzoom']).toBeUndefined();
    expect(layer(s, 'place_city')['minzoom']).toBe(5);
    expect(layer(s, 'place_country')['minzoom']).toBe(1);
    expect(layer(s, 'place_city')['paint']).toMatchObject({ 'text-color': '#t', 'text-halo-color': '#b' });
  });

  it('asks for the theme’s vector style', async () => {
    const asked: string[] = [];
    await buildStyle('plain', 'light', COLORS, DATA, async (url) => (asked.push(url), vectorBase));
    expect(asked).toEqual(['https://tiles.openfreemap.org/styles/positron']);
  });

  it('draws raster basemaps under the data', async () => {
    const s = await buildStyle('terrain', 'dark', COLORS, DATA, async () => {
      throw new Error('raster basemaps have no style to load');
    });
    expect(ids(s).slice(0, 3)).toEqual(['background', 'base', 'occ-fill']);
    expect(s.sources['base']).toMatchObject({ type: 'raster', tileSize: 256 });
    expect(s.glyphs).toMatch(/openfreemap/);
  });

  it('falls back to a plain background when the vector style cannot load', async () => {
    const s = await buildStyle('plain', 'dark', COLORS, DATA, async () => null);
    expect(ids(s).slice(0, 2)).toEqual(['background', 'occ-fill']);
    expect(s.sources['base']).toBeUndefined();
  });

  it('starts the sources from the data given', async () => {
    const selected = selectedGeoJson({
      ring: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
      wkt: '',
      tileTotal: 1,
    });
    const s = await buildStyle('plain', 'dark', COLORS, { ...DATA, selected }, async () => null);
    expect(s.sources['occ']).toMatchObject({ type: 'geojson', data: HEXES });
    expect(s.sources['selected']).toEqual({ type: 'geojson', data: selected });
  });
});

describe('fillColor', () => {
  it('bins cell counts by the grid level’s thresholds, as the legend does', () => {
    const steps = (level: number) => (fillColor(level) as unknown[]).filter((v) => typeof v === 'number');
    expect(steps(6)).toEqual(thresholdsAt(6));
    expect(steps(2)).toEqual(thresholdsAt(2));
    expect(fillColor(6).slice(0, 2)).toEqual(['step', ['get', 'total']]);
  });
});

describe('map GeoJSON', () => {
  it('draws the near-me pin and its circle', () => {
    expect(nearGeoJson(null, 2)).toBe(EMPTY);
    const fc = nearGeoJson({ lat: 51.5, lng: -0.1 }, 2);
    expect(fc.features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Point']);
  });

  it('outlines the selected cell', () => {
    expect(selectedGeoJson(null)).toBe(EMPTY);
  });

  it('reads a hex feature into its ring, WKT and count', () => {
    const square = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ];
    const feature = (geometry: GeoJSON.Geometry, total?: number) =>
      ({ geometry, properties: total === undefined ? {} : { total } }) as unknown as MapGeoJSONFeature;
    const g = geometryOf(feature({ type: 'Polygon', coordinates: [square] }, 42));
    expect(g).toMatchObject({ tileTotal: 42, wkt: 'POLYGON((0 0,1 0,1 1,0 1,0 0))' });
    expect(geometryOf(feature({ type: 'MultiPolygon', coordinates: [[square]] }))?.tileTotal).toBe(0);
    expect(geometryOf(feature({ type: 'Point', coordinates: [0, 0] }))).toBeNull();
    expect(
      geometryOf(
        feature({
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        }),
      ),
    ).toBeNull();
  });
});
