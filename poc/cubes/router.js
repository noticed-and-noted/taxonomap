/**
 * Picks where each part of a view comes from: the cubes, or GBIF. The cubes hold taxon, year and place for
 * the map, and month and record type too for the charts; anything else stays on GBIF. GBIF also keeps the
 * world view without a year range, which its tile cache already answers quickly.
 */
import { needsAdhoc } from './gbif.js';

/** Views at or below this zoom show the whole world. */
export const WORLD_ZOOM = 1;

/** The sources a view can come from. */
export const SOURCES = {
  cubes: 'Cubes',
  density: 'GBIF density tiles',
  adhoc: 'GBIF ad hoc tiles',
  facets: 'GBIF search facets',
};

const hasYearRange = (filters) => filters.yearFrom !== null || filters.yearTo !== null;

/** The GBIF tile kind a filter needs, and why the cubes can't serve it, or null when they can. */
function cubeGap(filters) {
  if (needsAdhoc(filters)) return { source: 'adhoc', reason: 'Months and photos on the map aren’t in the cubes' };
  if (filters.basis) return { source: 'density', reason: 'Record type on the map isn’t in the cubes' };
  return null;
}

/**
 * Where the map comes from.
 * @param {'auto' | 'cubes' | 'gbif'} mode auto routes as described above; the others force a source
 *   wherever it can serve the filter
 * @returns {{ source: keyof SOURCES, reason: string }}
 */
export function chooseMapSource(filters, view, mode) {
  const gap = cubeGap(filters);
  if (gap) return gap;
  if (mode === 'gbif') return { source: 'density', reason: 'GBIF chosen for every view' };
  if (mode === 'cubes') return { source: 'cubes', reason: 'Cubes chosen wherever they can serve the filter' };
  if (view.zoom <= WORLD_ZOOM && !hasYearRange(filters)) {
    return { source: 'density', reason: 'World view with no year range: GBIF usually has these tiles cached' };
  }
  return { source: 'cubes', reason: 'The cubes hold this taxon, year range and place' };
}

/**
 * Where the charts come from: the charts cube holds year, month and record type, but not photos.
 * @returns {{ source: 'cubes' | 'facets', reason: string }}
 */
export function chooseChartSource(filters, mode) {
  if (filters.hasPhoto) return { source: 'facets', reason: 'Photos aren’t in the cubes' };
  if (mode === 'gbif') return { source: 'facets', reason: 'GBIF chosen for every view' };
  return { source: 'cubes', reason: 'The charts cube holds year, month and record type' };
}
