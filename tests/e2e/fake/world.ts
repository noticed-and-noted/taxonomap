/**
 * A small, fixed stand-in for GBIF, iNaturalist, the basemaps and the
 * geocoder, so the journeys never touch the network. `answer` maps a request
 * URL to a response; the offline build (fake/server.ts) and the browser
 * (fixtures.ts) share it, so baked data and live answers always agree.
 *
 * The world: two kingdoms, a handful of classes, orders, families and
 * genera, and six species, each with a record count spread evenly over
 * 1900–2025, every month, two countries and two datasets. Records sit in
 * London, so every circle and cell anywhere holds the same species.
 */
import { fromVectorTileJs } from '@maplibre/vt-pbf';

export const FAKE_PORT = 4399;
export const FAKE_BASE = `http://127.0.0.1:${FAKE_PORT}`;

type Rank = 'KINGDOM' | 'PHYLUM' | 'CLASS' | 'ORDER' | 'FAMILY' | 'GENUS' | 'SPECIES';
interface Taxon {
  key: number;
  rank: Rank;
  name: string;
  common: string;
  parent?: number;
  /** Records (species only; higher taxa sum their species). */
  records?: number;
}

const TAXA: Taxon[] = [
  { key: 1, rank: 'KINGDOM', name: 'Animalia', common: 'Animals' },
  { key: 6, rank: 'KINGDOM', name: 'Plantae', common: 'Plants' },
  { key: 44, rank: 'PHYLUM', name: 'Chordata', common: 'Chordates', parent: 1 },
  { key: 7707728, rank: 'PHYLUM', name: 'Tracheophyta', common: 'Vascular plants', parent: 6 },
  { key: 212, rank: 'CLASS', name: 'Aves', common: 'Birds', parent: 44 },
  { key: 359, rank: 'CLASS', name: 'Mammalia', common: 'Mammals', parent: 44 },
  { key: 220, rank: 'CLASS', name: 'Magnoliopsida', common: 'Dicots', parent: 7707728 },
  { key: 729, rank: 'ORDER', name: 'Passeriformes', common: 'Perching Birds', parent: 212 },
  { key: 732, rank: 'ORDER', name: 'Carnivora', common: 'Carnivores', parent: 359 },
  { key: 1354, rank: 'ORDER', name: 'Fagales', common: 'Beech order', parent: 220 },
  { key: 5235, rank: 'FAMILY', name: 'Corvidae', common: 'Crows', parent: 729 },
  { key: 5290, rank: 'FAMILY', name: 'Turdidae', common: 'Thrushes', parent: 729 },
  { key: 9322, rank: 'FAMILY', name: 'Muscicapidae', common: 'Old World flycatchers', parent: 729 },
  { key: 9701, rank: 'FAMILY', name: 'Canidae', common: 'Dogs', parent: 732 },
  { key: 4689, rank: 'FAMILY', name: 'Fagaceae', common: 'Beech family', parent: 1354 },
  { key: 2482468, rank: 'GENUS', name: 'Corvus', common: 'Crows', parent: 5235 },
  { key: 2490714, rank: 'GENUS', name: 'Turdus', common: 'Thrushes', parent: 5290 },
  { key: 2492460, rank: 'GENUS', name: 'Erithacus', common: 'Robins', parent: 9322 },
  { key: 5219142, rank: 'GENUS', name: 'Vulpes', common: 'Foxes', parent: 9701 },
  { key: 2877951, rank: 'GENUS', name: 'Quercus', common: 'Oaks', parent: 4689 },
  // The blackbird out-records the robin, so a one-page build pre-renders it and the robin uses /species/view.
  {
    key: 2490719,
    rank: 'SPECIES',
    name: 'Turdus merula',
    common: 'Common Blackbird',
    parent: 2490714,
    records: 9_000_000,
  },
  {
    key: 2492462,
    rank: 'SPECIES',
    name: 'Erithacus rubecula',
    common: 'European Robin',
    parent: 2492460,
    records: 8_000_000,
  },
  {
    key: 2490680,
    rank: 'SPECIES',
    name: 'Turdus philomelos',
    common: 'Song Thrush',
    parent: 2490714,
    records: 4_000_000,
  },
  { key: 2482492, rank: 'SPECIES', name: 'Corvus corone', common: 'Carrion Crow', parent: 2482468, records: 3_000_000 },
  { key: 5219243, rank: 'SPECIES', name: 'Vulpes vulpes', common: 'Red Fox', parent: 5219142, records: 900_000 },
  {
    key: 2878688,
    rank: 'SPECIES',
    name: 'Quercus robur',
    common: 'Pedunculate Oak',
    parent: 2877951,
    records: 1_500_000,
  },
];

const byKey = new Map(TAXA.map((taxon) => [taxon.key, taxon]));
const RANK_FIELD: Record<Rank, string> = {
  KINGDOM: 'kingdom',
  PHYLUM: 'phylum',
  CLASS: 'class',
  ORDER: 'order',
  FAMILY: 'family',
  GENUS: 'genus',
  SPECIES: 'species',
};

function ancestors(taxon: Taxon): Taxon[] {
  const out: Taxon[] = [];
  for (
    let ancestor = taxon.parent && byKey.get(taxon.parent);
    ancestor;
    ancestor = ancestor.parent ? byKey.get(ancestor.parent) : undefined
  )
    out.unshift(ancestor);
  return out;
}
const isUnder = (taxon: Taxon, key: number) =>
  taxon.key === key || ancestors(taxon).some((ancestor) => ancestor.key === key);
const SPECIES = TAXA.filter((taxon) => taxon.rank === 'SPECIES');
const recordsOf = (taxon: Taxon) =>
  SPECIES.filter((species) => isUnder(species, taxon.key)).reduce((total, species) => total + species.records!, 0);

/** A GBIF name usage, with its higher keys and names. */
function usage(taxon: Taxon) {
  const higher: Record<string, string | number> = {};
  for (const ancestor of [...ancestors(taxon), taxon]) {
    higher[`${RANK_FIELD[ancestor.rank]}Key`] = ancestor.key;
    higher[RANK_FIELD[ancestor.rank]] = ancestor.name;
  }
  return {
    key: taxon.key,
    scientificName: taxon.rank === 'SPECIES' ? `${taxon.name} (Linnaeus, 1758)` : taxon.name,
    canonicalName: taxon.name,
    rank: taxon.rank,
    taxonomicStatus: 'ACCEPTED',
    vernacularName: taxon.common,
    vernacularNames: [{ vernacularName: taxon.common, language: 'eng' }],
    ...(taxon.parent && { parentKey: taxon.parent }),
    ...higher,
  };
}

const YEARS = Array.from({ length: 126 }, (_unused, index) => 1900 + index);
const DATASETS = [
  { key: 'b1047888-ae52-4179-9dd5-5448ea342a24', title: 'Garden bird survey' },
  { key: '50c9509d-22c7-4a22-a47d-8c48425ef4a7', title: 'iNaturalist research-grade observations' },
];

/** How every species' records divide among the values of the other facets. */
const SPLITS: Record<string, [string | number, number][]> = {
  year: YEARS.map((year) => [year, 1 / YEARS.length]),
  month: Array.from({ length: 12 }, (_unused, index) => [index + 1, 1 / 12]),
  country: [
    ['GB', 0.6],
    ['FR', 0.4],
  ],
  datasetKey: [
    [DATASETS[0]!.key, 0.7],
    [DATASETS[1]!.key, 0.3],
  ],
  basisOfRecord: [['HUMAN_OBSERVATION', 1]],
};

/** The species a search's filters select. */
function speciesFor(params: URLSearchParams): Taxon[] {
  const taxa = params.getAll('taxonKey').map(Number);
  const species = params.getAll('speciesKey').map(Number);
  const classKey = params.get('classKey');
  return SPECIES.filter(
    (candidate) =>
      (!taxa.length || taxa.some((key) => isUnder(candidate, key))) &&
      (!species.length || species.includes(candidate.key)) &&
      (!classKey || isUnder(candidate, Number(classKey))),
  );
}

/** The share of each species' records that a search's filters keep. */
function shareFor(params: URLSearchParams): number {
  let share = 1;
  const months = params.getAll('month');
  if (months.length) share *= months.length / 12;
  const year = params.get('year');
  if (year) {
    const [fromYear, toYear = fromYear] = year.split(',').map(Number);
    share *=
      YEARS.filter((candidateYear) => candidateYear >= fromYear! && candidateYear <= toYear!).length / YEARS.length;
  }
  if (params.get('geometry')) share *= 0.0001;
  if (params.get('eventDate')) share *= 0.00001;
  return share;
}

function facet(field: string, counts: Map<string, number>, limit: number, offset: number) {
  const rows = [...counts].filter(([, count]) => count > 0).sort((left, right) => right[1] - left[1]);
  return {
    field: field.replace(/[A-Z]/g, (capital) => `_${capital}`).toUpperCase(),
    counts: rows.slice(offset, offset + limit).map(([name, count]) => ({ name, count })),
  };
}

function occurrenceSearch(params: URLSearchParams) {
  const species = speciesFor(params);
  const share = shareFor(params);
  const scaledRecords = (taxon: Taxon) => Math.max(1, Math.round(taxon.records! * share));
  const count = species.reduce((sum, taxon) => sum + scaledRecords(taxon), 0);
  const limit = Number(params.get('limit') ?? 20);
  const facetLimit = Number(params.get('facetLimit') ?? 10);
  const offset = Number(params.get('facetOffset') ?? 0);
  const facets = params.getAll('facet').map((field) => {
    const counts = new Map<string, number>();
    const add = (key: string | number, amount: number) =>
      counts.set(String(key), (counts.get(String(key)) ?? 0) + amount);
    const rank = Object.entries(RANK_FIELD).find(([, fieldName]) => `${fieldName}Key` === field)?.[0] as
      Rank | undefined;
    for (const taxon of species) {
      if (rank) add([...ancestors(taxon), taxon].find((ancestor) => ancestor.rank === rank)!.key, scaledRecords(taxon));
      else for (const [key, part] of SPLITS[field] ?? []) add(key, scaledRecords(taxon) * part);
    }
    for (const [key, rawCount] of counts) counts.set(key, Math.round(rawCount));
    return facet(field, counts, Number(params.get(`${field}.facetLimit`) ?? facetLimit), offset);
  });
  const today = new Date();
  const results = Array.from({ length: Math.min(limit, species.length * 3) }, (_unused, index) => {
    const taxon = species[index % species.length]!;
    const day = new Date(today.getTime() - (index + 1) * 86_400_000).toISOString().slice(0, 10);
    return {
      key: 4_000_000_000 + taxon.key * 10 + Math.floor(index / species.length),
      datasetKey: DATASETS[0]!.key,
      publisher: 'Garden Bird Club',
      license: 'http://creativecommons.org/licenses/by/4.0/legalcode',
      ...Object.fromEntries(
        Object.entries(usage(taxon)).filter(([key]) =>
          /Key$|^(kingdom|phylum|class|order|family|genus|species)$/.test(key),
        ),
      ),
      taxonKey: taxon.key,
      species: taxon.name,
      scientificName: `${taxon.name} (Linnaeus, 1758)`,
      basisOfRecord: 'HUMAN_OBSERVATION',
      decimalLatitude: 51.5,
      decimalLongitude: -0.12,
      eventDate: day,
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
      country: 'United Kingdom of Great Britain and Northern Ireland',
      countryCode: 'GB',
      recordedBy: 'A. Birder',
      media: [
        { type: 'StillImage', identifier: `https://photos.example/${taxon.key}/${index}.jpg`, creator: 'A. Birder' },
      ],
    };
  });
  return { offset: 0, limit, endOfRecords: results.length < limit, count, results, facets };
}

function speciesSearch(params: URLSearchParams) {
  const limit = Number(params.get('limit') ?? 20);
  if (params.get('facet') === 'higherTaxonKey') {
    const under = params.get('highertaxonKey');
    const counts = new Map<string, number>();
    for (const taxon of TAXA) {
      if (taxon.rank === 'SPECIES' || (under && !isUnder(taxon, Number(under)) && taxon.key !== Number(under)))
        continue;
      counts.set(String(taxon.key), SPECIES.filter((species) => isUnder(species, taxon.key)).length);
    }
    return {
      offset: 0,
      limit: 0,
      endOfRecords: true,
      count: 0,
      results: [],
      facets: [facet('higherTaxonKey', counts, 9999, 0)],
    };
  }
  let found = TAXA;
  const rank = params.get('rank');
  if (rank) found = found.filter((taxon) => taxon.rank === rank);
  const under = Number(params.get('highertaxonKey'));
  if (under) found = found.filter((taxon) => taxon.key !== under && isUnder(taxon, under));
  const text = params.get('q')?.toLowerCase();
  if (text)
    found = found.filter(
      (taxon) => taxon.common.toLowerCase().includes(text) || taxon.name.toLowerCase().includes(text),
    );
  const offset = Number(params.get('offset') ?? 0);
  const page = found.slice(offset, offset + limit);
  return { offset, limit, endOfRecords: offset + limit >= found.length, count: found.length, results: page.map(usage) };
}

/* ---------- Tiles and images ---------- */

/** A 1 × 1 transparent PNG: every raster tile and photo. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);

/**
 * A density tile of hexes (about 28 across, as GBIF's are), each with
 * records, over Britain only: every journey looks there, and a sparse world
 * keeps MapLibre's software-rendered frames cheap.
 */
function hexTile(zoom: number, tileX: number, tileY: number): Uint8Array {
  const EXTENT = 4096;
  const radius = EXTENT / 28 / 1.5;
  const hexHeight = Math.sqrt(3) * radius;
  const tileCount = 2 ** zoom;
  const lngOf = (px: number) => ((tileX + px / EXTENT) / tileCount) * 360 - 180;
  const latOf = (py: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + py / EXTENT)) / tileCount))) * 180) / Math.PI;
  const features: {
    id: number;
    type: 3;
    extent: number;
    properties: { total: number };
    loadGeometry: () => { x: number; y: number }[][];
  }[] = [];
  for (let column = 0; column * 1.5 * radius <= EXTENT + radius; column++) {
    for (let row = 0; row * hexHeight <= EXTENT + hexHeight; row++) {
      const centreX = column * 1.5 * radius;
      const centreY = row * hexHeight + (column % 2 ? hexHeight / 2 : 0);
      const [lng, lat] = [lngOf(centreX), latOf(centreY)];
      if (lng < -12 || lng > 4 || lat < 48 || lat > 62) continue;
      const ring = [0, 60, 120, 180, 240, 300, 0].map((angle) => ({
        x: Math.round(centreX + radius * Math.cos((angle * Math.PI) / 180)),
        y: Math.round(centreY + radius * Math.sin((angle * Math.PI) / 180)),
      }));
      const total = 2 * (40 + ((column * 7 + row * 13) % 400));
      features.push({
        id: features.length + 1,
        type: 3 as const,
        extent: EXTENT,
        properties: { total },
        loadGeometry: () => [ring],
      });
    }
  }
  return fromVectorTileJs({
    layers: {
      occurrence: {
        version: 2,
        name: 'occurrence',
        extent: EXTENT,
        length: features.length,
        feature: (index) => features[index]! as never,
      },
    },
  });
}
const tiles = new Map<string, Uint8Array>();

/* ---------- Routing ---------- */

export interface FakeResponse {
  status: number;
  contentType: string;
  body: string | Uint8Array;
}

const json = (body: unknown, status = 200): FakeResponse => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const png = (): FakeResponse => ({ status: 200, contentType: 'image/png', body: PNG });
const missing = (): FakeResponse => json({ message: 'not found' }, 404);

/**
 * The answer to a request, or undefined for a URL nothing here serves.
 * Paths are matched whatever the host: the build points the GBIF bases and
 * basemaps at the fake server, and the browser's hard-coded hosts
 * (api.inaturalist.org, tile.gbif.org) are routed here too.
 */
export function answer(url: URL): FakeResponse | undefined {
  const path = url.pathname;
  const params = url.searchParams;
  if (url.hostname === 'api.inaturalist.org' || path.startsWith('/inat/'))
    return json({ total_results: 0, results: [] });
  if (url.hostname === 'tile.gbif.org' || url.hostname === 'photos.example') return png();
  if (path === '/geocode')
    return json(
      params.get('q')?.toLowerCase().startsWith('london')
        ? [
            {
              display_name: 'London, Greater London, England, United Kingdom',
              name: 'London',
              lat: '51.5073',
              lon: '-0.1277',
              boundingbox: ['51.28', '51.69', '-0.51', '0.33'],
            },
          ]
        : [],
    );
  // Basemaps: no vector style, so the map draws its plain fallback; raster tiles are blank.
  if (path.startsWith('/basemap/')) return path.endsWith('.json') ? missing() : png();

  if (path === '/v1/occurrence/search') return json(occurrenceSearch(params));
  if (path === '/v1/species/search') return json(speciesSearch(params));
  if (path === '/v1/species/suggest') {
    const text = (params.get('q') ?? '').toLowerCase();
    return json(
      TAXA.filter((taxon) => taxon.name.toLowerCase().startsWith(text))
        .slice(0, Number(params.get('limit') ?? 8))
        .map(usage),
    );
  }
  let match = /^\/v1\/species\/(\d+)(?:\/(\w+))?$/.exec(path);
  if (match) {
    const taxon = byKey.get(Number(match[1]));
    if (!taxon) return missing();
    const page = (results: unknown[]) => json({ offset: 0, limit: results.length, endOfRecords: true, results });
    switch (match[2]) {
      case undefined:
        return json(usage(taxon));
      case 'vernacularNames':
        return page([{ vernacularName: taxon.common, language: 'eng' }]);
      case 'synonyms':
        return page([]);
      case 'children':
        return page(TAXA.filter((child) => child.parent === taxon.key).map(usage));
      case 'parents':
        return json(ancestors(taxon).map(usage));
      default:
        return missing();
    }
  }
  match = /^\/v1\/(dataset|organization)\/([\w-]+)$/.exec(path);
  if (match)
    return json({
      key: match[2],
      title: DATASETS.find((dataset) => dataset.key === match![2])?.title ?? 'Garden Bird Club',
    });
  if (path === '/v2/map/occurrence/density/capabilities.json') {
    const total = speciesFor(params).reduce((running, species) => running + species.records!, 0);
    return json({ minLat: 49, maxLat: 59, minLng: -8, maxLng: 2, total });
  }
  match = /^\/v2\/map\/occurrence\/(?:density|adhoc)\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(path);
  if (match) {
    if (!tiles.has(path)) tiles.set(path, hexTile(Number(match[1]), Number(match[2]), Number(match[3])));
    return { status: 200, contentType: 'application/x-protobuf', body: tiles.get(path)! };
  }
  if (/^\/v2\/map\/occurrence\/(density|adhoc)\/\d+\/\d+\/\d+@\dx\.png$/.test(path)) return png();
  if (path.startsWith('/v1/image/')) return png();
  return undefined;
}

/** Counts the fake holds, for journeys that check figures. */
export const WORLD = { recordsOf: (key: number) => recordsOf(byKey.get(key)!) };
