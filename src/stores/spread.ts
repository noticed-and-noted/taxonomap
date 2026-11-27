/**
 * Spread on the map: the cells Analyse's Spread view loaded, drawn for its year. The map shows them in place of the
 * occurrence hexes while Spread is open with cells loaded.
 */
import { atom, computed } from 'nanostores';
import { spreadCollection, type SpreadCells } from '~/lib/analyse/spread';
import { $analyseView, $analyseYear, $analyseYears, yearsIncluded } from './analyse';
import { $mode } from './mode';

/** The loaded spread for the species being analysed; null until loaded, and once Spread closes. */
export const $spreadCells = atom<SpreadCells | null>(null);

/**
 * The years Spread steps through: those included, starting at the first year a cell appears. A species' few early
 * records are often scattered one to a cell, so no cell may count for decades; those empty years are left off.
 */
export const $spreadRange = computed([$analyseYears, $spreadCells], (years, cells): readonly [number, number] => {
  const [first, last] = yearsIncluded(years);
  const cellYears = cells ? [...cells.firstYears.values()] : [];
  if (!cellYears.length) return [first, last];
  return [Math.min(Math.max(first, Math.min(...cellYears)), last), last];
});

/** Spread's year: the one picked, kept inside Spread's years; the last of them when none is picked. */
export const $spreadYear = computed([$analyseYear, $spreadRange], (year, [first, last]) =>
  Math.min(Math.max(year ?? last, first), last),
);

/** The spread cells to draw, or null to draw the occurrence hexes. */
export const $spreadMap = computed([$mode, $analyseView, $spreadCells, $spreadYear], (mode, view, cells, year) => {
  if (mode !== 'analyse' || view !== 'spread' || !cells) return null;
  return spreadCollection(cells, year);
});
