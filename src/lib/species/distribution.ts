/**
 * Countries a species has been introduced to, merged from GBIF checklist distributions. Native status
 * is left out, as on GBIF's own pages: few checklists record it, so it reads as an incomplete range.
 */
import type { Distribution } from '~/lib/gbif';

/** ISO country codes, each sorted and without duplicates. */
export interface DistributionSummary {
  introduced: string[];
  invasive: string[];
  /** How many checklists contributed a row. */
  sources: number;
}

const INTRODUCED_MEANS = new Set(['INTRODUCED', 'NATURALISED', 'INVASIVE']);

// Tags rows with the countries a species came from, so a ladybird reads as "introduced" to China.
const UNRELIABLE_SOURCES = ['Catálogo Taxonômico da Fauna do Brasil'];

/** A row from a named checklist that isn't known to mislabel countries. */
function isTrusted(row: Distribution): row is Distribution & { source: string } {
  const source = row.source?.trim();
  return Boolean(source) && !UNRELIABLE_SOURCES.some((unreliable) => source?.startsWith(unreliable));
}

/**
 * Merges checklist rows into the countries a species was introduced to; invasive countries are also
 * introduced. Rows without a named source, or from an unreliable one, are dropped.
 * shortcut: rows with only a free-text locality ("North America", "Tenerife") are skipped; map them to
 * countries if the section looks thin for many species.
 * @returns null when no trusted row names an introduced country.
 */
export function summariseDistributions(rows: Distribution[]): DistributionSummary | null {
  const introduced = new Set<string>();
  const invasive = new Set<string>();
  const sources = new Set<string>();
  for (const row of rows) {
    if (!row.country || !INTRODUCED_MEANS.has(row.establishmentMeans ?? '') || !isTrusted(row)) continue;
    introduced.add(row.country);
    if (row.establishmentMeans === 'INVASIVE') invasive.add(row.country);
    sources.add(row.source);
  }
  if (!introduced.size) return null;
  return { introduced: [...introduced].sort(), invasive: [...invasive].sort(), sources: sources.size };
}
