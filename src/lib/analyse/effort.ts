/**
 * Adjusting for recording effort. More records can mean more people looking rather than more of a species, so
 * Migration can show the species as a share of its group's records (all birds, for a swallow), month by month and
 * cell by cell, and Spread can show new cells per million records of everything that year.
 */
import type { HigherKeys } from '~/lib/gbif';

/** The group a species' records are compared with: its class, or the nearest rank above it GBIF has. */
export interface RecordingGroup {
  key: number;
  /** Plain words where there are some, as they read before "records" ("bird"), else the scientific name. */
  name: string;
}

/** Plain names for the classes most species in Analyse belong to, as they read before "records". */
const GROUP_NAMES: Readonly<Record<number, string>> = {
  212: 'bird',
  216: 'insect',
  359: 'mammal',
  131: 'amphibian',
  11592253: 'reptile',
  204: 'ray-finned fish',
  220: 'flowering plant',
  196: 'flowering plant',
  367: 'arachnid',
  225: 'snail and slug',
  229: 'crustacean',
  137: 'bivalve',
  186: 'mushroom',
};

/**
 * Upper bounds of the map's share bins: the share of the group's records a cell's lightest to darkest colours
 * stand for, on a log scale like the record bins.
 */
export const SHARE_THRESHOLDS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3] as const;

/** Records of a million, for Spread's rate. */
const MILLION = 1_000_000;

/** The group a species is compared with: its class, else its phylum, else its kingdom; null with none. */
export function recordingGroup(usage: HigherKeys): RecordingGroup | null {
  const ranks = [
    [usage.classKey, usage.class],
    [usage.phylumKey, usage.phylum],
    [usage.kingdomKey, usage.kingdom],
  ] as const;
  const found = ranks.find(([key]) => key !== undefined);
  if (!found) return null;
  const [key, scientificName] = found;
  return { key: key!, name: GROUP_NAMES[key!] ?? scientificName ?? 'related species’' };
}

/** A count as a share of its baseline, 0 when there's no baseline. */
export function shareOf(count: number, baseline: number): number {
  return baseline > 0 ? Math.min(1, count / baseline) : 0;
}

/** A share as a percentage, to two significant figures ("0.42%", "12%"), or "<0.01%" for a sliver. */
export function formatShare(share: number): string {
  if (share === 0) return '0%';
  if (share < 0.0001) return '<0.01%';
  return `${Number((share * 100).toPrecision(2))}%`;
}

/** How many there are per million of `total`, 0 when there's no total. */
export function perMillion(count: number, total: number): number {
  return total > 0 ? (count / total) * MILLION : 0;
}

/** A rate to two significant figures below 10 ("0.42", "3.1"), whole above ("27"). */
export function formatRate(rate: number): string {
  return rate < 10 ? String(Number(rate.toPrecision(2))) : Math.round(rate).toLocaleString('en');
}
