/**
 * Data for "What's near me". Requests are batched per page:
 *   classes in the area      → 1 facet request
 *   a page of species/class  → 1 facet request (facetOffset paging)
 *   names + photos for page  → 1 image search for all species on the page
 *                               (+ cached detail lookups for any names that
 *                                neither the index nor the photos supplied)
 *   recent sightings         → 1 search + titles of the few datasets involved
 */
import { loadSnapshot } from '~/lib/data/load';
import { nameIndexWithin } from '~/lib/data/name-index';
import {
  circleToWkt,
  findImages,
  getDataset,
  getSpecies,
  occurrenceFacets,
  searchOccurrences,
  usableImages,
  type Occurrence,
  type UsableImage,
} from '~/lib/gbif';

export interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
  /** 1–12: only records from this calendar month (any year). */
  month?: number | undefined;
}

export interface ClassGroup {
  key: number;
  name: string;
  common?: string;
  records: number;
}

export interface NearSpecies {
  key: number;
  scientificName: string;
  commonName?: string;
  records: number;
  image?: UsableImage;
  classKey: number;
}

const filterFor = (a: Area, extra: { taxonKey?: number } = {}) => ({
  geometry: circleToWkt(a.lat, a.lng, a.radiusKm),
  month: a.month,
  ...extra,
});

let classNames: Promise<Map<number, { name: string; common?: string }>> | undefined;
function classNameMap() {
  classNames ??= loadSnapshot('tree').then(
    (t) =>
      new Map(
        (t?.nodes ?? []).filter((n) => n.r === 'C').map((n) => [n.k, { name: n.n, ...(n.c && { common: n.c }) }]),
      ),
  );
  return classNames;
}

/** Total records and the classes present, most-recorded first. */
export async function classesNear(a: Area, signal?: AbortSignal): Promise<{ records: number; classes: ClassGroup[] }> {
  const [r, names] = await Promise.all([
    occurrenceFacets(filterFor(a), ['classKey'], { facetLimit: 20, ...(signal && { signal }) }),
    classNameMap(),
  ]);
  const classes = await Promise.all(
    (r.facets['classKey'] ?? []).map(async (c): Promise<ClassGroup> => {
      const key = Number(c.name);
      let n = names.get(key);
      if (!n) {
        const u = await getSpecies(key).catch(() => null);
        n = { name: u?.canonicalName ?? u?.scientificName ?? `Class ${key}` };
      }
      return { key, name: n.name, ...(n.common && { common: n.common }), records: c.count };
    }),
  );
  return { records: r.count, classes };
}

/** One page of species for a class, ranked by records, with names and photos. */
export async function speciesPage(
  a: Area,
  classKey: number,
  offset: number,
  limit = 12,
  signal?: AbortSignal,
): Promise<{ species: NearSpecies[]; more: boolean }> {
  const r = await occurrenceFacets(filterFor(a, { taxonKey: classKey }), ['speciesKey'], {
    facetLimit: limit + 1,
    facetOffset: offset,
    ...(signal && { signal }),
  });
  const rows = (r.facets['speciesKey'] ?? []).map((c) => ({ key: Number(c.name), records: c.count }));
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!page.length) return { species: [], more: false };

  const [idx, photos] = await Promise.all([
    nameIndexWithin(1200),
    findImages({ speciesKeys: page.map((p) => p.key) }, { limit: 80 }).catch(() => null),
  ]);
  const imageBy = new Map<number, UsableImage>();
  for (const img of photos?.images ?? []) {
    if (img.speciesKey !== undefined && !imageBy.has(img.speciesKey)) imageBy.set(img.speciesKey, img);
  }
  const species = await Promise.all(
    page.map(async (p): Promise<NearSpecies> => {
      const row = idx?.get(p.key);
      let sci = row?.[2] ?? photos?.names.get(p.key);
      if (!sci)
        sci = await getSpecies(p.key)
          .then((u) => u.canonicalName ?? u.scientificName)
          .catch(() => `Species ${p.key}`);
      const image = imageBy.get(p.key);
      return {
        key: p.key,
        scientificName: sci,
        ...(row?.[3] && { commonName: row[3] }),
        records: p.records,
        classKey,
        ...(image && { image }),
      };
    }),
  );
  return { species, more };
}

export interface Sighting {
  occurrence: Occurrence;
  image: UsableImage;
  date: string;
  commonName?: string;
  datasetTitle?: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Latest dated records with photos from the past year, newest first. */
export async function recentSightings(a: Area, limit = 24, signal?: AbortSignal): Promise<Sighting[]> {
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(now.getFullYear() - 1);
  const res = await searchOccurrences(
    { ...filterFor(a), hasImage: true, eventDate: `${isoDay(yearAgo)},${isoDay(now)}` },
    { limit: 60 },
    signal,
  );
  const idx = await nameIndexWithin(800);
  const rows = res.results
    .map((o) => ({ o, img: usableImages(o)[0] }))
    .filter((x): x is { o: Occurrence; img: UsableImage } => !!x.img && !!x.o.eventDate)
    .sort((x, y) => (y.o.eventDate ?? '').localeCompare(x.o.eventDate ?? ''))
    .slice(0, limit);
  // Titles for the handful of datasets involved (attribution on every card).
  const titles = new Map<string, string>();
  await Promise.all(
    [...new Set(rows.map((r) => r.o.datasetKey))].map(async (k) => {
      const d = await getDataset(k).catch(() => null);
      if (d) titles.set(k, d.title);
    }),
  );
  return rows.map(({ o, img }) => {
    const sk = o.speciesKey ?? o.taxonKey;
    const common = sk !== undefined ? idx?.get(sk)?.[3] : undefined;
    const title = titles.get(o.datasetKey);
    return {
      occurrence: o,
      image: img,
      date: (o.eventDate ?? '').slice(0, 10),
      ...(common && { commonName: common }),
      ...(title && { datasetTitle: title }),
    };
  });
}

/**
 * Distinct species (and the top names) overall and per class — fetched when
 * the share dialog opens (click), one facet request per group.
 */
export async function speciesTallies(
  a: Area,
  classes: readonly ClassGroup[],
): Promise<{ total: number; topNames: string[]; groups: (ClassGroup & { species: number; topNames: string[] })[] }> {
  const LIMIT = 3000;
  const idx = await nameIndexWithin(800);
  const tally = async (taxonKey?: number) => {
    const r = await occurrenceFacets(filterFor(a, taxonKey ? { taxonKey } : {}), ['speciesKey'], { facetLimit: LIMIT });
    const rows = r.facets['speciesKey'] ?? [];
    const topNames = rows
      .slice(0, 6)
      .map((c) => idx?.get(Number(c.name)))
      .map((row) => row?.[3] ?? row?.[2])
      .filter((n): n is string => !!n)
      .slice(0, 3);
    return { species: rows.length, topNames };
  };
  const [all, ...per] = await Promise.all([tally(), ...classes.slice(0, 6).map((c) => tally(c.key))]);
  return {
    total: all?.species ?? 0,
    topNames: all?.topNames ?? [],
    groups: classes.slice(0, 6).map((c, i) => ({ ...c, ...(per[i] ?? { species: 0, topNames: [] }) })),
  };
}
