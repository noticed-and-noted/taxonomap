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

const byKey = new Map(TAXA.map((t) => [t.key, t]));
const RANK_FIELD: Record<Rank, string> = {
  KINGDOM: 'kingdom',
  PHYLUM: 'phylum',
  CLASS: 'class',
  ORDER: 'order',
  FAMILY: 'family',
  GENUS: 'genus',
  SPECIES: 'species',
};

function ancestors(t: Taxon): Taxon[] {
  const out: Taxon[] = [];
  for (let p = t.parent && byKey.get(t.parent); p; p = p.parent ? byKey.get(p.parent) : undefined) out.unshift(p);
  return out;
}
const isUnder = (t: Taxon, key: number) => t.key === key || ancestors(t).some((a) => a.key === key);
const SPECIES = TAXA.filter((t) => t.rank === 'SPECIES');
const recordsOf = (t: Taxon) => SPECIES.filter((s) => isUnder(s, t.key)).reduce((n, s) => n + s.records!, 0);

/** A GBIF name usage, with its higher keys and names. */
function usage(t: Taxon) {
  const higher: Record<string, string | number> = {};
  for (const a of [...ancestors(t), t]) {
    higher[`${RANK_FIELD[a.rank]}Key`] = a.key;
    higher[RANK_FIELD[a.rank]] = a.name;
  }
  return {
    key: t.key,
    scientificName: t.rank === 'SPECIES' ? `${t.name} (Linnaeus, 1758)` : t.name,
    canonicalName: t.name,
    rank: t.rank,
    taxonomicStatus: 'ACCEPTED',
    vernacularName: t.common,
    vernacularNames: [{ vernacularName: t.common, language: 'eng' }],
    ...(t.parent && { parentKey: t.parent }),
    ...higher,
  };
}

const YEARS = Array.from({ length: 126 }, (_, i) => 1900 + i);
const DATASETS = [
  { key: 'b1047888-ae52-4179-9dd5-5448ea342a24', title: 'Garden bird survey' },
  { key: '50c9509d-22c7-4a22-a47d-8c48425ef4a7', title: 'iNaturalist research-grade observations' },
];

/** How every species' records divide among the values of the other facets. */
const SPLITS: Record<string, [string | number, number][]> = {
  year: YEARS.map((y) => [y, 1 / YEARS.length]),
  month: Array.from({ length: 12 }, (_, i) => [i + 1, 1 / 12]),
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
function speciesFor(q: URLSearchParams): Taxon[] {
  const taxa = q.getAll('taxonKey').map(Number);
  const species = q.getAll('speciesKey').map(Number);
  const classKey = q.get('classKey');
  return SPECIES.filter(
    (s) =>
      (!taxa.length || taxa.some((k) => isUnder(s, k))) &&
      (!species.length || species.includes(s.key)) &&
      (!classKey || isUnder(s, Number(classKey))),
  );
}

/** The share of each species' records that a search's filters keep. */
function shareFor(q: URLSearchParams): number {
  let share = 1;
  const months = q.getAll('month');
  if (months.length) share *= months.length / 12;
  const year = q.get('year');
  if (year) {
    const [a, b = a] = year.split(',').map(Number);
    share *= YEARS.filter((y) => y >= a! && y <= b!).length / YEARS.length;
  }
  if (q.get('geometry')) share *= 0.0001;
  if (q.get('eventDate')) share *= 0.00001;
  return share;
}

function facet(field: string, counts: Map<string, number>, limit: number, offset: number) {
  const rows = [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return {
    field: field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase(),
    counts: rows.slice(offset, offset + limit).map(([name, count]) => ({ name, count })),
  };
}

function occurrenceSearch(q: URLSearchParams) {
  const species = speciesFor(q);
  const share = shareFor(q);
  const n = (s: Taxon) => Math.max(1, Math.round(s.records! * share));
  const count = species.reduce((t, s) => t + n(s), 0);
  const limit = Number(q.get('limit') ?? 20);
  const facetLimit = Number(q.get('facetLimit') ?? 10);
  const offset = Number(q.get('facetOffset') ?? 0);
  const facets = q.getAll('facet').map((field) => {
    const counts = new Map<string, number>();
    const add = (k: string | number, v: number) => counts.set(String(k), (counts.get(String(k)) ?? 0) + v);
    const rank = Object.entries(RANK_FIELD).find(([, f]) => `${f}Key` === field)?.[0] as Rank | undefined;
    for (const s of species) {
      if (rank) add([...ancestors(s), s].find((a) => a.rank === rank)!.key, n(s));
      else for (const [k, part] of SPLITS[field] ?? []) add(k, n(s) * part);
    }
    for (const [k, v] of counts) counts.set(k, Math.round(v));
    return facet(field, counts, Number(q.get(`${field}.facetLimit`) ?? facetLimit), offset);
  });
  const today = new Date();
  const results = Array.from({ length: Math.min(limit, species.length * 3) }, (_, i) => {
    const s = species[i % species.length]!;
    const day = new Date(today.getTime() - (i + 1) * 86_400_000).toISOString().slice(0, 10);
    return {
      key: 4_000_000_000 + s.key * 10 + Math.floor(i / species.length),
      datasetKey: DATASETS[0]!.key,
      publisher: 'Garden Bird Club',
      license: 'http://creativecommons.org/licenses/by/4.0/legalcode',
      ...Object.fromEntries(
        Object.entries(usage(s)).filter(([k]) => /Key$|^(kingdom|phylum|class|order|family|genus|species)$/.test(k)),
      ),
      taxonKey: s.key,
      species: s.name,
      scientificName: `${s.name} (Linnaeus, 1758)`,
      basisOfRecord: 'HUMAN_OBSERVATION',
      decimalLatitude: 51.5,
      decimalLongitude: -0.12,
      eventDate: day,
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
      country: 'United Kingdom of Great Britain and Northern Ireland',
      countryCode: 'GB',
      recordedBy: 'A. Birder',
      media: [{ type: 'StillImage', identifier: `https://photos.example/${s.key}/${i}.jpg`, creator: 'A. Birder' }],
    };
  });
  return { offset: 0, limit, endOfRecords: results.length < limit, count, results, facets };
}

function speciesSearch(q: URLSearchParams) {
  const limit = Number(q.get('limit') ?? 20);
  if (q.get('facet') === 'higherTaxonKey') {
    const under = q.get('highertaxonKey');
    const counts = new Map<string, number>();
    for (const t of TAXA) {
      if (t.rank === 'SPECIES' || (under && !isUnder(t, Number(under)) && t.key !== Number(under))) continue;
      counts.set(String(t.key), SPECIES.filter((s) => isUnder(s, t.key)).length);
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
  const rank = q.get('rank');
  if (rank) found = found.filter((t) => t.rank === rank);
  const text = q.get('q')?.toLowerCase();
  if (text) found = found.filter((t) => t.common.toLowerCase().includes(text) || t.name.toLowerCase().includes(text));
  const offset = Number(q.get('offset') ?? 0);
  const page = found.slice(offset, offset + limit);
  return { offset, limit, endOfRecords: offset + limit >= found.length, count: found.length, results: page.map(usage) };
}

/* ---------- Tiles and images ---------- */

/** A 1 × 1 transparent PNG: every raster tile and photo. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/**
 * A density tile of hexes (about 28 across, as GBIF's are), each with
 * records, over Britain only: every journey looks there, and a sparse world
 * keeps MapLibre's software-rendered frames cheap.
 */
function hexTile(z: number, x: number, y: number): Uint8Array {
  const E = 4096;
  const r = E / 28 / 1.5;
  const h = Math.sqrt(3) * r;
  const n = 2 ** z;
  const lngOf = (px: number) => ((x + px / E) / n) * 360 - 180;
  const latOf = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / E)) / n))) * 180) / Math.PI;
  const features: {
    id: number;
    type: 3;
    extent: number;
    properties: { total: number };
    loadGeometry: () => { x: number; y: number }[][];
  }[] = [];
  for (let col = 0; col * 1.5 * r <= E + r; col++) {
    for (let row = 0; row * h <= E + h; row++) {
      const cx = col * 1.5 * r;
      const cy = row * h + (col % 2 ? h / 2 : 0);
      const [lng, lat] = [lngOf(cx), latOf(cy)];
      if (lng < -12 || lng > 4 || lat < 48 || lat > 62) continue;
      const ring = [0, 60, 120, 180, 240, 300, 0].map((a) => ({
        x: Math.round(cx + r * Math.cos((a * Math.PI) / 180)),
        y: Math.round(cy + r * Math.sin((a * Math.PI) / 180)),
      }));
      const total = 2 * (40 + ((col * 7 + row * 13) % 400));
      features.push({
        id: features.length + 1,
        type: 3 as const,
        extent: E,
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
        extent: E,
        length: features.length,
        feature: (i) => features[i]! as never,
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
  const p = url.pathname;
  const q = url.searchParams;
  if (url.hostname === 'api.inaturalist.org' || p.startsWith('/inat/')) return json({ total_results: 0, results: [] });
  if (url.hostname === 'tile.gbif.org' || url.hostname === 'photos.example') return png();
  if (p === '/geocode')
    return json(
      q.get('q')?.toLowerCase().startsWith('london')
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
  if (p.startsWith('/basemap/')) return p.endsWith('.json') ? missing() : png();

  if (p === '/v1/occurrence/search') return json(occurrenceSearch(q));
  if (p === '/v1/species/search') return json(speciesSearch(q));
  if (p === '/v1/species/suggest') {
    const text = (q.get('q') ?? '').toLowerCase();
    return json(
      TAXA.filter((t) => t.name.toLowerCase().startsWith(text))
        .slice(0, Number(q.get('limit') ?? 8))
        .map(usage),
    );
  }
  let m = /^\/v1\/species\/(\d+)(?:\/(\w+))?$/.exec(p);
  if (m) {
    const t = byKey.get(Number(m[1]));
    if (!t) return missing();
    const page = (results: unknown[]) => json({ offset: 0, limit: results.length, endOfRecords: true, results });
    switch (m[2]) {
      case undefined:
        return json(usage(t));
      case 'vernacularNames':
        return page([{ vernacularName: t.common, language: 'eng' }]);
      case 'synonyms':
        return page([]);
      case 'children':
        return page(TAXA.filter((c) => c.parent === t.key).map(usage));
      case 'parents':
        return json(ancestors(t).map(usage));
      default:
        return missing();
    }
  }
  m = /^\/v1\/(dataset|organization)\/([\w-]+)$/.exec(p);
  if (m) return json({ key: m[2], title: DATASETS.find((d) => d.key === m![2])?.title ?? 'Garden Bird Club' });
  if (p === '/v2/map/occurrence/density/capabilities.json') {
    const total = speciesFor(q).reduce((n, s) => n + s.records!, 0);
    return json({ minLat: 49, maxLat: 59, minLng: -8, maxLng: 2, total });
  }
  m = /^\/v2\/map\/occurrence\/(?:density|adhoc)\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(p);
  if (m) {
    if (!tiles.has(p)) tiles.set(p, hexTile(Number(m[1]), Number(m[2]), Number(m[3])));
    return { status: 200, contentType: 'application/x-protobuf', body: tiles.get(p)! };
  }
  if (/^\/v2\/map\/occurrence\/(density|adhoc)\/\d+\/\d+\/\d+@\dx\.png$/.test(p)) return png();
  if (p.startsWith('/v1/image/')) return png();
  return undefined;
}

/** Counts the fake holds, for journeys that check figures. */
export const WORLD = { recordsOf: (key: number) => recordsOf(byKey.get(key)!) };
