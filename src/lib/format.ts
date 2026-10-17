const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat('en');

/** 1.2M, 34K, 950 */
export function compact(n: number): string {
  return compactFmt.format(n);
}

/** 1,234,567 */
export function full(n: number): string {
  return fullFmt.format(n);
}

/** "1 record" / "12,345 records" */
let regionNames: Intl.DisplayNames | undefined;

/** ISO 3166-1 alpha-2 → English country name (falls back to the code). */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const CONTINENT_LABELS: Record<string, string> = {
  AFRICA: 'Africa',
  ANTARCTICA: 'Antarctica',
  ASIA: 'Asia',
  EUROPE: 'Europe',
  NORTH_AMERICA: 'North America',
  OCEANIA: 'Oceania',
  SOUTH_AMERICA: 'South America',
};

export const IUCN_LABELS: Record<string, string> = {
  EX: 'Extinct',
  EW: 'Extinct in the wild',
  CR: 'Critically endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near threatened',
  LC: 'Least concern',
  DD: 'Data deficient',
};

/** "10 m", "1 km". */
export function distance(m: number): string {
  return m >= 1000 ? `${m / 1000} km` : `${m} m`;
}

export const BASIS_LABELS: Record<string, string> = {
  HUMAN_OBSERVATION: 'Human observation',
  PRESERVED_SPECIMEN: 'Preserved specimen',
  MACHINE_OBSERVATION: 'Machine observation',
  MATERIAL_SAMPLE: 'Material sample',
  FOSSIL_SPECIMEN: 'Fossil specimen',
  LIVING_SPECIMEN: 'Living specimen',
  MATERIAL_CITATION: 'Material citation',
  OCCURRENCE: 'Occurrence',
  OBSERVATION: 'Observation',
};

export const RANK_LABELS: Record<string, string> = {
  K: 'Kingdom',
  P: 'Phylum',
  C: 'Class',
  O: 'Order',
  F: 'Family',
  G: 'Genus',
  S: 'Species',
  KINGDOM: 'Kingdom',
  PHYLUM: 'Phylum',
  CLASS: 'Class',
  ORDER: 'Order',
  FAMILY: 'Family',
  GENUS: 'Genus',
  SPECIES: 'Species',
  SUBSPECIES: 'Subspecies',
};
