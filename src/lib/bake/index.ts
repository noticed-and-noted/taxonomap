/**
 * Build-time data baking (Node only). Each function is used by a static
 * endpoint in src/pages/data/ and memoised so several pages can share one
 * result within a build.
 */
import pLimit from 'p-limit';
import {
  getSpecies,
  getVernacularNames,
  listByRank,
  occurrenceFacets,
  type NameUsage,
  type VernacularName,
} from '~/lib/gbif/server';
import type { CountriesSnapshot, NameRow, NamesSnapshot, RankCode, YearsSnapshot } from '~/lib/data/types';
import { englishName } from '~/lib/species/names';
import { speciesSlug } from '~/lib/species/data';

const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    memo.set(key, p);
  }
  return p;
}

const meta = () => ({ v: 1 as const, generated: new Date().toISOString() });

export function bakeYears(): Promise<YearsSnapshot> {
  return once('years', async () => {
    const r = await occurrenceFacets({}, ['year'], { facetLimit: 1000 });
    const years = (r.facets['year'] ?? [])
      .map((c) => [Number(c.name), c.count] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    return { ...meta(), total: r.count, years };
  });
}

export function bakeCountries(): Promise<CountriesSnapshot> {
  return once('countries', async () => {
    const r = await occurrenceFacets({}, ['country'], { facetLimit: 300 });
    return { ...meta(), countries: (r.facets['country'] ?? []).map((c) => [c.name, c.count] as [string, number]) };
  });
}

/* ---------------- Name index ---------------- */

/**
 * Groups naturalists search by common name. The top species of each group
 * (by occurrence count) are added to the global top list.
 */
const SPECIES_GROUPS: { key: number; label: string; share: number }[] = [
  { key: 212, label: 'Birds', share: 0.3 },
  { key: 359, label: 'Mammals', share: 0.08 },
  { key: 131, label: 'Amphibians', share: 0.03 },
  { key: 11592253, label: 'Lizards & snakes', share: 0.03 },
  { key: 11418114, label: 'Turtles', share: 0.01 },
  { key: 789, label: 'Dragonflies', share: 0.03 },
  { key: 797, label: 'Butterflies & moths', share: 0.08 },
  { key: 194, label: 'Conifers', share: 0.01 },
  { key: 1354, label: 'Oaks, birches & allies', share: 0.01 },
];

const RANK_CODE: Record<string, RankCode> = {
  KINGDOM: 'K',
  PHYLUM: 'P',
  CLASS: 'C',
  ORDER: 'O',
  FAMILY: 'F',
  GENUS: 'G',
  SPECIES: 'S',
};

export function isDev(): boolean {
  return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
}

/**
 * Index size. Each species costs two small, disk-cached GBIF requests
 * (detail + vernacular names), shared with the species pages in Phase 3.
 */
function indexSize(): number {
  const fromEnv = Number(process.env['NAME_INDEX_SIZE']);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return isDev() ? 300 : 6000;
}

async function topSpeciesKeys(total: number): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const globalShare = 1 - SPECIES_GROUPS.reduce((s, g) => s + g.share, 0);
  const add = (rows: { name: string; count: number }[] | undefined, limit: number) => {
    let added = 0;
    for (const r of rows ?? []) {
      if (added >= limit) break;
      const k = Number(r.name);
      if (!counts.has(k)) added++;
      counts.set(k, r.count);
    }
  };
  const global = await occurrenceFacets({}, ['speciesKey'], { facetLimit: Math.ceil(total * globalShare) });
  add(global.facets['speciesKey'], Number.POSITIVE_INFINITY);
  for (const g of SPECIES_GROUPS) {
    const want = Math.ceil(total * g.share);
    // Over-fetch so overlap with the global list still yields `want` new keys.
    const r = await occurrenceFacets({ taxonKey: g.key }, ['speciesKey'], { facetLimit: want * 2 });
    add(r.facets['speciesKey'], want);
  }
  return counts;
}

async function higherRanks(): Promise<NameRow[]> {
  const facets = await occurrenceFacets({}, ['kingdomKey', 'phylumKey', 'classKey', 'orderKey', 'familyKey'], {
    facetLimit: 3000,
  });
  const counts = new Map<number, number>();
  for (const f of ['kingdomKey', 'phylumKey', 'classKey', 'orderKey', 'familyKey']) {
    for (const c of facets.facets[f] ?? []) counts.set(Number(c.name), c.count);
  }
  // Bulk names for classes and orders (a handful of pages, not one call each).
  const usages = new Map<number, NameUsage & { vernacularNames?: VernacularName[] }>();
  for (const rank of ['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER'] as const) {
    for (let offset = 0; ; offset += 1000) {
      const page = await listByRank(rank, offset, 1000);
      for (const u of page.results) usages.set(u.key, u);
      if (page.endOfRecords || page.results.length === 0) break;
    }
  }
  // Families: only the most-recorded, fetched individually (cached).
  const familyCount = isDev() ? 40 : 400;
  const topFamilies = (facets.facets['familyKey'] ?? []).slice(0, familyCount).map((c) => Number(c.name));
  const limit = pLimit(5);
  await Promise.all(
    topFamilies.map((k) =>
      limit(async () => {
        try {
          usages.set(k, await getSpecies(k));
        } catch {
          /* skip unknown keys */
        }
      }),
    ),
  );

  const rows: NameRow[] = [];
  for (const [key, count] of counts) {
    const u = usages.get(key);
    const rank = u && RANK_CODE[u.rank];
    if (!u || !rank || count < 1000) continue;
    const common =
      (u.vernacularNames && englishName(u.vernacularNames)) ??
      (u.vernacularName ? u.vernacularName.charAt(0).toUpperCase() + u.vernacularName.slice(1) : null);
    rows.push([key, rank, u.canonicalName ?? u.scientificName, common, count]);
  }
  return rows;
}

async function speciesRows(counts: Map<number, number>): Promise<NameRow[]> {
  const limit = pLimit(5);
  const rows = await Promise.all(
    [...counts].map(([key, count]) =>
      limit(async (): Promise<NameRow | null> => {
        try {
          const [u, v] = await Promise.all([getSpecies(key), getVernacularNames(key, 100)]);
          return [key, 'S', u.canonicalName ?? u.scientificName, englishName(v.results), count];
        } catch {
          return null;
        }
      }),
    ),
  );
  return rows.filter((r): r is NameRow => r !== null);
}

export function bakeNames(): Promise<NamesSnapshot> {
  return once('names', async () => {
    const [higher, species] = await Promise.all([higherRanks(), topSpeciesKeys(indexSize()).then(speciesRows)]);
    const names = [...higher, ...species].sort((a, b) => b[4] - a[4]);
    return { ...meta(), names };
  });
}

/* ---------------- Pre-rendered species ---------------- */

/**
 * Major classes and their share of the pre-render budget, so pages cover
 * what naturalists look up (birds, insects, plants…) rather than only the
 * globally most-recorded species, which are overwhelmingly birds.
 */
const PRERENDER_CLASSES: { key: number; share: number }[] = [
  { key: 212, share: 0.3 }, // Aves
  { key: 216, share: 0.14 }, // Insecta
  { key: 220, share: 0.16 }, // Magnoliopsida
  { key: 196, share: 0.04 }, // Liliopsida
  { key: 359, share: 0.06 }, // Mammalia
  { key: 131, share: 0.02 }, // Amphibia
  { key: 11592253, share: 0.02 }, // Squamata
  { key: 204, share: 0.03 }, // Actinopterygii
  { key: 367, share: 0.02 }, // Arachnida
  { key: 225, share: 0.02 }, // Gastropoda
  { key: 186, share: 0.03 }, // Agaricomycetes
  { key: 180, share: 0.01 }, // Lecanoromycetes
  { key: 194, share: 0.01 }, // Pinopsida
  { key: 7228684, share: 0.01 }, // Polypodiopsida
];

export function prerenderCount(): number {
  const n = Number(process.env['SPECIES_PRERENDER_COUNT']);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return isDev() ? 12 : 2000;
}

export interface PrerenderSpecies {
  key: number;
  slug: string;
  count: number;
}

/** The species that get static pages (memoised; shared by pages, OG images and the manifest). */
export function bakeSpeciesList(): Promise<PrerenderSpecies[]> {
  return once('species-list', async () => {
    const total = prerenderCount();
    if (total === 0) return [];
    const picked = new Map<number, number>();
    const take = (rows: { name: string; count: number }[] | undefined, want: number) => {
      let added = 0;
      for (const r of rows ?? []) {
        if (added >= want || picked.size >= total) break;
        const k = Number(r.name);
        if (!picked.has(k)) {
          picked.set(k, r.count);
          added++;
        }
      }
    };
    for (const c of PRERENDER_CLASSES) {
      const want = Math.ceil(total * c.share);
      const r = await occurrenceFacets({ taxonKey: c.key }, ['speciesKey'], { facetLimit: want + 20 });
      take(r.facets['speciesKey'], want);
    }
    // Fill the remainder from the global ranking.
    if (picked.size < total) {
      const r = await occurrenceFacets({}, ['speciesKey'], { facetLimit: total * 2 });
      take(r.facets['speciesKey'], total - picked.size);
    }
    const limit = pLimit(5);
    const rows = await Promise.all(
      [...picked].map(([key, count]) =>
        limit(async (): Promise<PrerenderSpecies | null> => {
          try {
            const u = await getSpecies(key);
            // Only accepted species get a canonical page.
            if (u.rank !== 'SPECIES') return null;
            return { key, slug: speciesSlug(u), count };
          } catch {
            return null;
          }
        }),
      ),
    );
    return rows.filter((r): r is PrerenderSpecies => r !== null).sort((a, b) => b.count - a.count);
  });
}

/** key → slug for every pre-rendered species (links elsewhere use /species/view). */
export async function bakeSpeciesManifest(): Promise<Record<string, string>> {
  const list = await bakeSpeciesList();
  return Object.fromEntries(list.map((s) => [String(s.key), s.slug]));
}

/** Common-name lookup from the baked name index (build time). */
export async function bakedCommonNames(): Promise<(key: number) => string | null> {
  const { names } = await bakeNames();
  const map = new Map(names.filter((r) => r[3]).map((r) => [r[0], r[3] as string]));
  return (key) => map.get(key) ?? null;
}
