/**
 * How a GBIF occurrence record's fields read in the cell's record list: short
 * type codes, dates, accuracy and the names the row and its links use.
 */
import { BASIS_LABELS, distance } from '~/lib/format';
import type { Occurrence } from '~/lib/gbif';

/** Three-letter codes for GBIF's basis of record, short enough for a narrow column. */
export const TYPE_CODES: Record<string, string> = {
  HUMAN_OBSERVATION: 'OBS',
  MACHINE_OBSERVATION: 'MAC',
  PRESERVED_SPECIMEN: 'SPE',
  LIVING_SPECIMEN: 'LIV',
  FOSSIL_SPECIMEN: 'FOS',
  MATERIAL_SAMPLE: 'SAM',
  MATERIAL_CITATION: 'CIT',
  OCCURRENCE: 'OCC',
  OBSERVATION: 'OBS',
};

/** iNaturalist's wording when the observer, not a threatened-taxon rule, blurred the point. */
const OBSERVER_BLURRED = /request of the observer/i;

/** Taxon for the about page: the species, else whatever the record was named to (a genus or family). */
export function aboutKey(occurrence: Occurrence): number | undefined {
  return occurrence.speciesKey ?? occurrence.acceptedTaxonKey ?? occurrence.taxonKey;
}

/** The accepted name, so the row matches the about page it links to (a synonym's record shows its accepted taxon). */
export function recordScientificName(occurrence: Occurrence): string | undefined {
  return occurrence.species ?? occurrence.acceptedScientificName ?? occurrence.scientificName;
}

/** The record's date as YYYY-MM-DD, or just its year when that's all it has. */
export function recordDate(occurrence: Occurrence): string | undefined {
  return occurrence.eventDate?.slice(0, 10) ?? (occurrence.year ? String(occurrence.year) : undefined);
}

/** The basis of record in words, for the type code's tooltip. */
export function typeLabel(occurrence: Occurrence): string {
  return (
    (occurrence.basisOfRecord && (BASIS_LABELS[occurrence.basisOfRecord] ?? occurrence.basisOfRecord)) || 'Unknown'
  );
}

/** The type column's short code, or a dash when the record has none. */
export function typeCode(occurrence: Occurrence): string {
  return TYPE_CODES[occurrence.basisOfRecord ?? ''] ?? '—';
}

/** Institution and catalogue number, for specimens. */
export function institution(occurrence: Occurrence): string {
  return [occurrence.institutionCode, occurrence.catalogNumber].filter(Boolean).join(' ');
}

/** How precise the point is ("Within 1 km"), noting when the observer blurred it; '' when unknown. */
export function accuracy(occurrence: Occurrence): string {
  const metres = occurrence.coordinateUncertaintyInMeters;
  if (!metres) return '';
  const blurred = OBSERVER_BLURRED.test(occurrence.informationWithheld ?? '') ? ' · blurred by observer' : '';
  return `Within ${distance(metres)}${blurred}`;
}

/** Up to two capital initials of a name, shown where a record has no photo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
}
