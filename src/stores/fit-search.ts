/**
 * Whether picking a species or group in the map's search moves the map to its
 * records (map settings), remembered per browser. On unless turned off. Links
 * that name taxa but no view (the species and tree pages' "View on map") move
 * the map the same way.
 */
import { atom } from 'nanostores';
import type { TileFilter } from '~/lib/gbif';
import { boundsAround, recordsView } from '~/lib/map/taxonView';
import { $flyTo, $occurrenceFilter, $taxonKeys } from './explorer';
import { $nearMode } from './near';
import { linkParams } from './url-sync';

export const FIT_SEARCH_KEY = 'map-fit-search';
const OFF = 'off';

function saved(): boolean {
  try {
    return localStorage.getItem(FIT_SEARCH_KEY) !== OFF;
  } catch {
    return true;
  }
}

export const $fitOnSearch = atom(typeof window === 'undefined' ? true : saved());

/**
 * Turn moving to a search pick's records on or off.
 * @param isOn Whether a pick moves the map.
 */
export function setFitOnSearch(isOn: boolean) {
  try {
    if (isOn) localStorage.removeItem(FIT_SEARCH_KEY);
    else localStorage.setItem(FIT_SEARCH_KEY, OFF);
  } catch {
    /* Storage unavailable (private mode, blocked): keep the in-memory choice. */
  }
  $fitOnSearch.set(isOn);
}

/** Closest the map zooms in on a picked taxon, so a species known from one spot still shows its surroundings. */
const TAXON_MAX_ZOOM = 6;

/**
 * Zoom out to all of a filter's records, centred on the place with the most.
 * @param filter The records to show; defaults to the map's current filter.
 */
export async function flyToRecords(filter: TileFilter = $occurrenceFilter.get()) {
  try {
    const view = await recordsView(filter);
    if (!view) return;
    $flyTo.set({
      kind: 'bounds',
      bbox: boundsAround(view.busiest, view.extent),
      centre: view.busiest,
      maxZoom: TAXON_MAX_ZOOM,
    });
  } catch {
    /* stay where we are */
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
