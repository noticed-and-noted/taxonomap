/**
 * Cube mode keeps only filters the cubes answer (lib/cubes/filters.ts). Turning it on, or arriving at a
 * link with such a filter while it's on, clears the rest, and the banner names what was cleared, so no
 * filter stays applied unseen. The controls for them are greyed out while cube mode is on.
 */
import { atom } from 'nanostores';
import { isCubeRange, unsupportedFilters } from '~/lib/cubes/filters';
import { $cubesOn } from './cubes';
import { $continents, $dateRange, $exactTaxon, $iucn, $maxUncertainty, $occurrenceFilter } from './explorer';
import { $publisherKeys } from './publisher';

/** The filters cube mode last cleared, by name, for the banner; empty when none. */
export const $clearedForCubes = atom<string[]>([]);

/** Clear every set filter the cubes can't answer, and note which. */
export function clearUnsupported(): void {
  const cleared = unsupportedFilters($occurrenceFilter.get());
  if (!cleared.length) return;
  $exactTaxon.set(false);
  $iucn.set([]);
  $continents.set([]);
  $maxUncertainty.set(null);
  $publisherKeys.set([]);
  if (!isCubeRange($dateRange.get())) $dateRange.set(null);
  $clearedForCubes.set(cleared);
}

/**
 * Keep cube mode's filters to the cubes' own while the app runs.
 * @returns a function that stops watching
 */
export function startCubeMode(): () => void {
  const check = () => {
    if ($cubesOn.get()) clearUnsupported();
    else $clearedForCubes.set([]);
  };
  check();
  const stops = [$cubesOn.listen(check), $occurrenceFilter.listen(check)];
  return () => stops.forEach((stop) => stop());
}
