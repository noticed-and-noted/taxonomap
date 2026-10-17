/**
 * Data for "What's near me":
 *   classes in the area      → 1 facet request
 *   species in the area      → 1 facet request per leading class, then 1 batched name search (see species/groups.ts)
 *   recent sightings         → 1 search + titles of the few datasets involved
 */
import { nameIndexWithin } from '~/lib/data/name-index';
import { DAY } from '~/lib/util/time';
import {
  circleToWkt,
  getDataset,
  occurrenceFacets,
  searchOccurrences,
  usableImages,
  type Occurrence,
  type GbifImage,
} from '~/lib/gbif';
import { namedClasses, speciesInClasses, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';

export type { ClassGroup, SpeciesRow };

export interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
  /** 1–12: only records from this calendar month (any year). */
  month?: number | undefined;
}

const filterFor = (a: Area, extra: { taxonKey?: number } = {}) => ({
  geometry: circleToWkt(a.lat, a.lng, a.radiusKm),
  month: a.month,
  ...extra,
});

/** Total records and the classes present, most-recorded first. */
export async function classesNear(a: Area, signal?: AbortSignal): Promise<{ records: number; classes: ClassGroup[] }> {
  const r = await occurrenceFacets(filterFor(a), ['classKey'], { facetLimit: 20, ...(signal && { signal }) });
  return { records: r.count, classes: await namedClasses(r.facets['classKey'] ?? []) };
}

/** Top species of the most-recorded classes (photos are added separately). */
export const NEAR_CLASSES = 10;
export const NEAR_PER_CLASS = 40;
export function speciesNear(a: Area, classes: readonly ClassGroup[], signal?: AbortSignal): Promise<SpeciesRow[]> {
  return speciesInClasses(filterFor(a), classes, {
    maxClasses: NEAR_CLASSES,
    perClass: NEAR_PER_CLASS,
    ...(signal && { signal }),
  });
}

export interface Sighting {
  occurrence: Occurrence;
  image: GbifImage;
  date: string;
  commonName?: string;
  datasetTitle?: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Newest windows first: GBIF ignores sort, so a short window is what keeps the feed recent. */
const SIGHTING_WINDOWS_DAYS = [30, 365];

/** Latest dated records with photos, newest first: the past 30 days, widened to a year if that has too few. */
export async function recentSightings(a: Area, limit = 24, signal?: AbortSignal): Promise<Sighting[]> {
  const now = new Date();
  let rows: { o: Occurrence; img: GbifImage }[] = [];
  for (const days of SIGHTING_WINDOWS_DAYS) {
    const from = new Date(now.getTime() - days * DAY);
    const res = await searchOccurrences(
      { ...filterFor(a), hasImage: true, eventDate: `${isoDay(from)},${isoDay(now)}` },
      { limit: 60 },
      signal,
    );
    rows = res.results
      .map((o) => ({ o, img: usableImages(o)[0] }))
      .filter((x): x is { o: Occurrence; img: GbifImage } => !!x.img && !!x.o.eventDate)
      .sort((x, y) => (y.o.eventDate ?? '').localeCompare(x.o.eventDate ?? ''))
      .slice(0, limit);
    if (rows.length >= limit) break;
  }
  const idx = await nameIndexWithin(800);
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
    const common = sk !== undefined ? idx?.get(sk)?.commonName : undefined;
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
      .map((n) => n?.commonName ?? n?.scientificName)
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
