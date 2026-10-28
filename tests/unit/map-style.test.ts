/** The map's style: our layers spliced into each kind of basemap, and the GeoJSON helpers. */
import type { MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import {
  buildStyle,
  EMPTY,
  fetchStyle,
  fillColor,
  geometryOf,
  nearGeoJson,
  recordDotMinZoom,
  selectedGeoJson,
} from '~/lib/map/style';
import { json, stubNetwork } from './helpers/network';
import { thresholdsAt } from '~/lib/ramp';

const COLORS = { accent: '#a', accentContrast: '#c', bg: '#b', land: '#l', text: '#t' };
const HEXES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: '3:0,0', total: 4, home: true },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
  ],
};
const DATA = { hexes: HEXES, level: 6, selected: EMPTY, near: EMPTY };

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

const ids = (style: StyleSpecification) => style.layers.map((styleLayer) => styleLayer.id);
const layer = (style: StyleSpecification, id: string) =>
  style.layers.find((styleLayer) => styleLayer.id === id) as Record<string, unknown>;

describe('buildStyle', () => {
  it('puts the data under the basemap labels and selections on top', async () => {
    const style = await buildStyle('plain', 'dark', COLORS, DATA, async () => vectorBase);
    expect(ids(style)).toEqual([
      'background',
      'road_major',
      'water',
      'occ-fill',
      'place_city',
      'place_country',
      'hover-line',
      'selected-line',
      'near-area',
      'near-edge',
      'near-pin',
      'record-area',
      'record-edge',
      'selected-record',
    ]);
    expect(Object.keys(style.sources)).toEqual(['omt', 'occ', 'hover', 'selected', 'near']);
    // Cell ids let arriving tiles update the hexes in place.
    expect(style.sources['occ']).toMatchObject({ promoteId: 'id' });
    expect(style.projection).toEqual({ type: 'globe' });
  });

  it('keeps roads under the data when a label layer comes before them', async () => {
    const [background, road, water, ...labels] = vectorBase.layers;
    const labelFirst = { ...vectorBase, layers: [background!, ...labels, road!, water!] };
    const style = await buildStyle('plain', 'dark', COLORS, DATA, async () => labelFirst);
    expect(ids(style).slice(0, 4)).toEqual(['background', 'road_major', 'water', 'occ-fill']);
  });

  it('themes the basemap: background, label colours, and roads and minor labels only up close', async () => {
    const style = await buildStyle('plain', 'dark', COLORS, DATA, async () => vectorBase);
    expect(layer(style, 'background')['paint']).toEqual({ 'background-color': '#l' });
    expect(layer(style, 'road_major')['minzoom']).toBe(8);
    expect(layer(style, 'water')['minzoom']).toBeUndefined();
    expect(layer(style, 'place_city')['minzoom']).toBe(5);
    expect(layer(style, 'place_country')['minzoom']).toBe(1);
    expect(layer(style, 'place_city')['paint']).toMatchObject({ 'text-color': '#t', 'text-halo-color': '#b' });
  });

  it('sinks water to the page background on the dark style only', async () => {
    const dark = await buildStyle('plain', 'dark', COLORS, DATA, async () => vectorBase);
    const light = await buildStyle('plain', 'light', COLORS, DATA, async () => vectorBase);
    expect(layer(dark, 'water')['paint']).toEqual({ 'fill-color': '#b' });
    expect(layer(light, 'water')['paint']).toBeUndefined();
  });

  it('lifts the dark style’s near-black land fills to the land colour, leaving other fills', async () => {
    const withFills = {
      ...vectorBase,
      layers: [
        ...vectorBase.layers,
        { id: 'glacier', type: 'fill', source: 'omt', 'source-layer': 'landcover' },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#0f0' } },
      ],
    } as StyleSpecification;
    const dark = await buildStyle('plain', 'dark', COLORS, DATA, async () => withFills);
    expect(layer(dark, 'glacier')['paint']).toEqual({ 'fill-color': '#l' });
    expect(layer(dark, 'park')['paint']).toEqual({ 'fill-color': '#0f0' });
  });

  it('asks for the theme’s vector style', async () => {
    const asked: string[] = [];
    await buildStyle('plain', 'light', COLORS, DATA, async (url) => (asked.push(url), vectorBase));
    expect(asked).toEqual(['https://tiles.openfreemap.org/styles/positron']);
  });

  it('draws raster basemaps under the data, with the plain map’s labels on top', async () => {
    const asked: string[] = [];
    const style = await buildStyle('satellite', 'dark', COLORS, DATA, async (url) => (asked.push(url), vectorBase));
    expect(asked).toEqual(['https://tiles.openfreemap.org/styles/dark']);
    expect(ids(style).slice(0, 5)).toEqual(['background', 'base', 'occ-fill', 'place_city', 'place_country']);
    expect(style.sources['base']).toMatchObject({ type: 'raster', tileSize: 256 });
    expect(layer(style, 'place_city')['paint']).toMatchObject({ 'text-color': '#t', 'text-halo-color': '#b' });
  });

  it('draws raster basemaps without labels when the vector style cannot load', async () => {
    const style = await buildStyle('satellite', 'dark', COLORS, DATA, async () => null);
    expect(ids(style).slice(0, 3)).toEqual(['background', 'base', 'occ-fill']);
    expect(style.glyphs).toMatch(/openfreemap/);
  });

  it('puts the data on top of a basemap without labels', async () => {
    const unlabelled = {
      ...vectorBase,
      layers: vectorBase.layers.filter((styleLayer) => styleLayer.type !== 'symbol'),
    };
    const style = await buildStyle('plain', 'dark', COLORS, DATA, async () => unlabelled);
    expect(ids(style).slice(0, 3)).toEqual(['background', 'road_major', 'water']);
    expect(ids(style).indexOf('occ-fill')).toBe(3);
  });

  it('falls back to a plain background when the vector style cannot load', async () => {
    const style = await buildStyle('plain', 'dark', COLORS, DATA, async () => null);
    expect(ids(style).slice(0, 2)).toEqual(['background', 'occ-fill']);
    expect(style.sources['base']).toBeUndefined();
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
    const style = await buildStyle('plain', 'dark', COLORS, { ...DATA, selected }, async () => null);
    expect(style.sources['occ']).toMatchObject({ type: 'geojson', data: HEXES });
    expect(style.sources['selected']).toEqual({ type: 'geojson', data: selected });
  });
});

describe('fillColor', () => {
  it('bins cell counts by the grid level’s thresholds, as the legend does', () => {
    const steps = (level: number) => (fillColor(level) as unknown[]).filter((value) => typeof value === 'number');
    expect(steps(6)).toEqual(thresholdsAt(6));
    expect(steps(2)).toEqual(thresholdsAt(2));
    expect(fillColor(6).slice(0, 2)).toEqual(['step', ['get', 'total']]);
  });
});

describe('map GeoJSON', () => {
  it('draws the near-me pin and its circle', () => {
    expect(nearGeoJson(null, 2)).toBe(EMPTY);
    const collection = nearGeoJson({ lat: 51.5, lng: -0.1 }, 2);
    expect(collection.features.map((feature) => feature.geometry.type)).toEqual(['Polygon', 'Point']);
  });

  it('outlines the selected cell', () => {
    expect(selectedGeoJson(null)).toBe(EMPTY);
  });

  it('shows the record’s dot once its cell is three dots wide on screen', () => {
    expect(recordDotMinZoom(8, 54)).toBe(8);
    expect(recordDotMinZoom(8, 27)).toBe(9);
    expect(recordDotMinZoom(8, 108)).toBe(7);
    expect(recordDotMinZoom(8, null)).toBe(7);
    expect(recordDotMinZoom(8, 0)).toBe(24);
  });

  it('marks the expanded record, with or without a selected cell', () => {
    const point: GeoJSON.Point = { type: 'Point', coordinates: [-0.1, 51.5] };
    expect(selectedGeoJson(null, point).features).toEqual([
      { type: 'Feature', properties: { part: 'record' }, geometry: point },
    ]);
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
    const hex = feature({ type: 'Polygon', coordinates: [square] }, 42);
    const geometry = geometryOf(hex);
    expect(geometry).toMatchObject({ tileTotal: 42, wkt: 'POLYGON((0 0,1 0,1 1,0 1,0 0))' });
    // Built once per feature: the map asks it of every cell on every draw.
    expect(geometryOf(hex)).toBe(geometry);
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

describe('fetchStyle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches each style once, and is null when it cannot be loaded', async () => {
    const calls = stubNetwork((url) =>
      url.pathname === '/ok' ? vectorBase : url.pathname === '/bad' ? json({}, 500) : undefined,
    );
    await expect(fetchStyle('https://style.test/ok')).resolves.toEqual(vectorBase);
    await fetchStyle('https://style.test/ok');
    await expect(fetchStyle('https://style.test/bad')).resolves.toBeNull();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    await expect(fetchStyle('https://style.test/down')).resolves.toBeNull();
    expect(calls.filter((url) => url.pathname === '/ok')).toHaveLength(1);
  });
});
