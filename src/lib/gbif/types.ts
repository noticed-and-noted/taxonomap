/**
 * The subset of GBIF response fields this app depends on. Contract tests in
 * tests/contract assert these against the live API.
 */
import type { ALLOWED_LICENCE_ENUMS } from './licence';

export type Rank =
  | 'KINGDOM'
  | 'PHYLUM'
  | 'CLASS'
  | 'ORDER'
  | 'FAMILY'
  | 'GENUS'
  | 'SPECIES'
  | 'SUBSPECIES'
  | 'VARIETY'
  | 'FORM'
  | (string & {});

export type BasisOfRecord =
  | 'HUMAN_OBSERVATION'
  | 'PRESERVED_SPECIMEN'
  | 'MACHINE_OBSERVATION'
  | 'MATERIAL_SAMPLE'
  | 'FOSSIL_SPECIMEN'
  | 'LIVING_SPECIMEN'
  | 'MATERIAL_CITATION'
  | 'OCCURRENCE'
  | 'OBSERVATION';

export type Continent = 'AFRICA' | 'ANTARCTICA' | 'ASIA' | 'EUROPE' | 'NORTH_AMERICA' | 'OCEANIA' | 'SOUTH_AMERICA';

/** IUCN Red List categories as GBIF's `iucnRedListCategory` filter spells them. */
export type IucnCategory = 'EX' | 'EW' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC' | 'DD';

/** GBIF `license` enum values for the three licences GBIF accepts for data (listed in licence.ts). */
export type LicenceEnum = (typeof ALLOWED_LICENCE_ENUMS)[number];

export interface Paged<T> {
  offset: number;
  limit: number;
  endOfRecords: boolean;
  count?: number;
  results: T[];
}

export interface HigherKeys {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
}

export interface NameUsage extends HigherKeys {
  key: number;
  nubKey?: number;
  scientificName: string;
  canonicalName?: string;
  authorship?: string;
  vernacularName?: string;
  rank: Rank;
  taxonomicStatus?: string;
  parentKey?: number;
  parent?: string;
  acceptedKey?: number;
  accepted?: string;
  numDescendants?: number;
  datasetKey?: string;
}

export interface SuggestResult extends HigherKeys {
  key: number;
  scientificName: string;
  canonicalName?: string;
  rank: Rank;
  status?: string;
  synonym?: boolean;
}

export interface VernacularName {
  vernacularName: string;
  language?: string;
  source?: string;
  preferred?: boolean;
}

/** v1 /species/match */
export interface MatchV1 extends HigherKeys {
  usageKey?: number;
  acceptedUsageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  rank?: Rank;
  status?: string;
  confidence: number;
  matchType: 'EXACT' | 'FUZZY' | 'HIGHERRANK' | 'NONE' | (string & {});
}

/** v2 /species/match */
export interface MatchV2 {
  usage?: { key: string; name: string; canonicalName?: string; rank: Rank; status?: string };
  acceptedUsage?: { key: string; name: string; rank: Rank };
  classification?: { key: string; name: string; rank: Rank }[];
  diagnostics: { matchType: string; confidence?: number };
}

export interface FacetCount {
  name: string;
  count: number;
}

export interface Facet {
  /** Upper-snake field name as returned, e.g. "YEAR", "SPECIES_KEY". */
  field: string;
  counts: FacetCount[];
}

export interface Media {
  type?: 'StillImage' | 'MovingImage' | 'Sound' | (string & {});
  format?: string;
  identifier?: string;
  references?: string;
  title?: string;
  creator?: string;
  rightsHolder?: string;
  license?: string;
  publisher?: string;
}

export interface Occurrence extends HigherKeys {
  key: number;
  datasetKey: string;
  publishingOrgKey?: string;
  datasetName?: string;
  publisher?: string;
  license?: string;
  taxonKey?: number;
  acceptedTaxonKey?: number;
  scientificName?: string;
  acceptedScientificName?: string;
  vernacularName?: string;
  /** The source's own taxon ID (for iNaturalist records, the iNaturalist taxon ID). */
  taxonID?: string;
  basisOfRecord?: BasisOfRecord;
  decimalLatitude?: number;
  decimalLongitude?: number;
  coordinateUncertaintyInMeters?: number;
  eventDate?: string;
  year?: number;
  month?: number;
  day?: number;
  country?: string;
  countryCode?: string;
  locality?: string;
  recordedBy?: string;
  rightsHolder?: string;
  media?: Media[];
}

export interface OccurrenceSearch extends Paged<Occurrence> {
  count: number;
  facets?: Facet[];
}

export interface Dataset {
  key: string;
  title: string;
  publishingOrganizationKey?: string;
  license?: string;
  doi?: string;
  description?: string;
  citation?: { text?: string };
}

export interface Organization {
  key: string;
  title: string;
  country?: string;
  homepage?: string[];
}

export interface MapCapabilities {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minYear?: number;
  maxYear?: number;
  total: number;
  generated?: string;
}
