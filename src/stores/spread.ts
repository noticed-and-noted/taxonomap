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

/** Show only the cells first recorded in the year ("New only"), not every cell recorded by then. */
export const $spreadOnlyNew = atom(false);

/** Spread's year: the one picked, kept inside the years included; the last of them when none is picked. */
export const $spreadYear = computed([$analyseYear, $analyseYears], (year, years) => {
  const [first, last] = yearsIncluded(years);
  return Math.min(Math.max(year ?? last, first), last);
});

/** The spread cells to draw, or null to draw the occurrence hexes. */
export const $spreadMap = computed(
  [$mode, $analyseView, $spreadCells, $spreadYear, $spreadOnlyNew],
  (mode, view, cells, year, onlyNew) => {
    if (mode !== 'analyse' || view !== 'spread' || !cells) return null;
    return spreadCollection(cells, year, onlyNew);
  },
);
