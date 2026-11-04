/**
 * The cell panel's data from the cubes: one read of the cell's rows gives the count, months, classes
 * and species, and every class's species after that, so picking a group needs no request. The count
 * and months are ready at once; the lists wait for names, which come the way GBIF's facets get them
 * (species/groups.ts): the tree snapshot and baked index first.
 */
import { classKeysByName, namedClasses, topSpecies, type ClassGroup, type SpeciesRow } from '~/lib/species/groups';
import type { CubeCell } from './cell';
import { speciesCounts, summariseCell } from './cellSummary';

/** A cell's panel, and its species narrowed to one class. */
export interface CellPanel {
  count: number;
  months: number[];
  /** The classes and top species, once named. */
  lists(signal?: AbortSignal): Promise<{ classes: ClassGroup[]; species: SpeciesRow[] }>;
  /** The species of one class (by key), or of the whole cell for null; `signal` is the pick's own load. */
  groupSpecies(classKey: number | null, signal?: AbortSignal): Promise<SpeciesRow[]>;
}

/** A class name's GBIF key from the tree snapshot, or a stand-in key (below 0) for a class it lacks. */
function classKeyMaker(known: Map<string, number>) {
  const standIns = new Map<string, number>();
  return (name: string) => {
    const key = known.get(name) ?? standIns.get(name);
    if (key !== undefined) return key;
    standIns.set(name, -(standIns.size + 1));
    return -standIns.size;
  };
}

/**
 * Read a cell's rows and count them for its panel.
 * @param limits how many classes and species to list
 * @throws Error when the cubes can't be read
 */
export async function cellPanel(
  { cubes, query, cell, resolution }: CubeCell,
  limits: { classes: number; species: number },
): Promise<CellPanel> {
  const [rows, classKeys] = await Promise.all([cubes.cellRows(cell, resolution), classKeysByName()]);
  const summary = summariseCell(rows, query, cubes.scale, classKeyMaker(classKeys), limits);
  const classNames = new Map(summary.classes.map((facet) => [Number(facet.name), facet.label]));
  const named = (known: typeof summary.species, signal?: AbortSignal) =>
    topSpecies({}, { known, ...(signal && { signal }) });

  return {
    count: summary.count,
    months: summary.months,
    async lists(signal) {
      const [classes, species] = await Promise.all([namedClasses(summary.classes), named(summary.species, signal)]);
      return { classes, species };
    },
    groupSpecies(classKey, signal) {
      const className = classKey === null ? undefined : classNames.get(classKey);
      if (className === undefined) return named(summary.species, signal);
      return named(speciesCounts(rows, query, cubes.scale, { limit: limits.species, className }), signal);
    },
  };
}
