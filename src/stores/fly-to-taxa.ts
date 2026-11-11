/**
 * Moving the map to a taxon's records: after a search pick, and when a link
 * names taxa but no view (the species and tree pages' "View on map").
 */
import type { TileFilter } from '~/lib/gbif';
import { recordsView } from '~/lib/map/taxonView';
import { $flyTo, $occurrenceFilter, $taxonKeys } from './explorer';
import { $fitOnSearch } from './fit-search';
import { $nearMode } from './near';
import { linkParams } from './url-sync';

/** Closest the map zooms in on a picked taxon, so a species known from one spot still shows its surroundings. */
const TAXON_MAX_ZOOM = 6;

/**
 * Zoom out to all of a filter's records, centred on the middle of them.
 * @param filter The records to show; defaults to the map's current filter.
 */
export async function flyToRecords(filter: TileFilter = $occurrenceFilter.get()) {
  try {
    const view = await recordsView(filter);
    if (!view) return;
    $flyTo.set({ kind: 'bounds', bbox: view.extent, centre: view.centre, maxZoom: TAXON_MAX_ZOOM });
  } catch {
    /* Best effort: if the lookup fails (offline, GBIF down) the map stays where it is. */
  }
}

/** Whether a new choice of taxa should move the map: the setting is on, and Near me (which keeps the map on its pin) is off. */
export function shouldFitTaxa(): boolean {
  return $fitOnSearch.get() && !$nearMode.get();
}

/**
 * On opening the map from a link with taxa but no view, go to their records, as a search pick would.
 * A view the map put back from the last visit doesn't count: the link asked for the taxa.
 */
export function flyToLinkedTaxa() {
  const link = linkParams();
  if (!link.has('taxon') || link.has('view') || !$taxonKeys.get().length || !shouldFitTaxa()) return;
  void flyToRecords();
}
