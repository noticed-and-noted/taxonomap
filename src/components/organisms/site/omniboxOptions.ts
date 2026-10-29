/** The rows of the header search's listbox. */
import type { NameHit } from '~/lib/gbif';
import type { Place } from '~/lib/geocode';

/** A row in the header search: a species or group, a place, or the switch between the two searches. */
export type OmniboxOption =
  | { kind: 'taxon'; id: string; hit: NameHit }
  | { kind: 'place-search'; id: string }
  | { kind: 'species-search'; id: string }
  | { kind: 'place'; id: string; place: Place };
