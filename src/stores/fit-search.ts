/**
 * Whether picking a species or group in the map's search moves the map to its
 * records (map settings), remembered per browser. On unless turned off.
 */
import { atom } from 'nanostores';

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
