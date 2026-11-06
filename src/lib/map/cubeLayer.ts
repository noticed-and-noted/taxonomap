/**
 * The map's hexes from the pre-counted cubes instead of GBIF's tiles, in cube mode. Each settled view
 * reads the H3 resolution for its grid level, each selected taxon, and only the cells in view (or the
 * whole world, zoomed out); the counts become the same hex features GBIF's tiles do, so the legend,
 * colours, hover and the hex panel work unchanged. Counts from a sample are scaled to estimate the
 * whole snapshot.
 */
import { latLngToCell } from 'h3-js';
import type { Map as MlMap } from 'maplibre-gl';
import {
  cellToHex,
  colourLevel,
  estimateBounds,
  resolutionForLevel,
  viewBounds,
  type CubeResolution,
} from '~/lib/cubes/grid';
import { matchesFilters, needsFilterColumns } from '~/lib/cubes/match';
import { viewRanges } from '~/lib/cubes/ranges';
import type { CubeSet, MapRow } from '~/lib/cubes/reader';
import type { CubeQuery } from '~/lib/cubes/route';
import { gridLevel, type Hex, type LngLat } from './occGrid';
import type { OccLayer, OccLayerOptions } from './occLayer';

/** What the cube layer reads and how it reports back: the occurrence layer's callbacks, less its filter. */
export type CubeLayerOptions = Pick<OccLayerOptions, 'onCells' | 'onLevel' | 'onProgress' | 'onFailed' | 'isEmpty'> & {
  cubes: CubeSet;
  query: CubeQuery;
};

/** The occurrence layer's handle, plus switching to another taxon or years without a new layer. */
export interface CubeLayer extends OccLayer {
  setQuery(query: CubeQuery): void;
}

/**
 * Records per cell (hex id) under the query's filters, scaled to the whole snapshot. The rows are already
 * the query's taxa; several taxa nested in one another (a class and a species in it) are counted once each.
 */
export function sumCells(rows: readonly MapRow[], query: CubeQuery, scale: number): Map<string, number> {
  const sums = new Map<string, number>();
  for (const row of rows) {
    if (!matchesFilters(row, query)) continue;
    const cell = row.cell.toString(16);
    sums.set(cell, (sums.get(cell) ?? 0) + Number(row.records));
  }
  for (const [cell, total] of sums) sums.set(cell, Math.round(total * scale));
  return sums;
}

/** Loads cube cells for a map's view and hands them over as hex sets; see the file comment. */
class CubeLayerController {
  readonly #map: MlMap;
  readonly #options: CubeLayerOptions;
  #query: CubeQuery;
  #resolution: CubeResolution;
  #cells = new Map<string, Hex>();
  /** Bumped by every load, so a slow one finishing after a newer one is dropped. */
  #loadSeq = 0;

  constructor(map: MlMap, options: CubeLayerOptions) {
    this.#map = map;
    this.#options = options;
    this.#query = options.query;
    this.#resolution = this.#resolutionAt(map.getZoom(), map.getCenter().lat);
    options.onLevel(colourLevel(this.#resolution));
    map.on('moveend', this.#onMoveEnd);
    void this.#load();
  }

  #resolutionAt(zoom: number, lat: number): CubeResolution {
    const canvas = this.#map.getCanvas();
    return resolutionForLevel(gridLevel(zoom, lat, canvas.clientWidth, canvas.clientHeight));
  }

  readonly #onMoveEnd = () => {
    const next = this.#resolutionAt(this.#map.getZoom(), this.#map.getCenter().lat);
    if (next !== this.#resolution) {
      this.#resolution = next;
      this.#options.onLevel(colourLevel(next));
    }
    void this.#load();
  };

  async #load() {
    const seq = ++this.#loadSeq;
    const resolution = this.#resolution;
    const bounds = viewBounds(this.#map);
    this.#options.onProgress(0, 1);
    const ranges = bounds && viewRanges(bounds, resolution);
    let rows: MapRow[];
    try {
      const lean = !needsFilterColumns(this.#query);
      const perTaxon = this.#query.taxa.map((taxon) => this.#options.cubes.mapRows(taxon, resolution, ranges, lean));
      rows = (await Promise.all(perTaxon)).flat();
    } catch {
      // The cubes couldn't be read: say so as the GBIF layer does, and leave the last cells up.
      if (seq === this.#loadSeq) this.#options.onFailed();
      return;
    }
    if (seq !== this.#loadSeq) return;
    const sums = sumCells(rows, this.#query, this.#options.cubes.scale);
    this.#cells = new Map([...sums].map(([cell, total]) => [cell, cellToHex(cell, total)]));
    this.redraw();
    this.#options.onProgress(1, 1);
    // A hex click reads the cell cube: its footers come now, so the click needs one round trip.
    void this.#options.cubes.warmCells(resolution, ranges);
  }

  setQuery(query: CubeQuery) {
    this.#query = query;
    void this.#load();
  }

  collection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
    const { isEmpty } = this.#options;
    const features = [...this.#cells.values()].filter((hex) => !isEmpty?.(hex));
    return { type: 'FeatureCollection', features };
  }

  cellAt([lng, lat]: LngLat): Hex | undefined {
    return this.#cells.get(latLngToCell(lat, lng, this.#resolution));
  }

  async findCell([lng, lat]: LngLat, level: number): Promise<Hex | undefined> {
    const resolution = resolutionForLevel(level);
    const cell = latLngToCell(lat, lng, resolution);
    const loaded = resolution === this.#resolution ? this.#cells.get(cell) : undefined;
    return loaded ?? cellToHex(cell, 0);
  }

  levelAt(zoom: number, lat: number) {
    return colourLevel(this.#resolutionAt(zoom, lat));
  }

  redraw() {
    this.#options.onCells(this.collection());
  }

  destroy() {
    this.#loadSeq++;
    this.#map.off('moveend', this.#onMoveEnd);
  }
}

/**
 * Starts the reads a map view's first load will make, before the map is ready, from the view in the URL
 * and the window's size: the layer's own load then finds them on their way.
 * @returns when they're in; a failure is left to the layer's load to report
 */
export async function prefetchView(
  cubes: CubeSet,
  query: CubeQuery,
  view: { lng: number; lat: number; zoom: number },
  size: { width: number; height: number },
): Promise<void> {
  const resolution = resolutionForLevel(gridLevel(view.zoom, view.lat, size.width, size.height));
  const bounds = estimateBounds(view, size);
  const ranges = bounds && viewRanges(bounds, resolution);
  const lean = !needsFilterColumns(query);
  await Promise.all(query.taxa.map((taxon) => cubes.mapRows(taxon, resolution, ranges, lean)));
}

/**
 * Starts drawing a map's hexes from the cubes.
 * @param map The MapLibre map.
 * @param options The cubes, the query, and the occurrence layer's callbacks.
 * @returns The occurrence layer's handle, plus setQuery.
 */
export function createCubeLayer(map: MlMap, options: CubeLayerOptions): CubeLayer {
  const layer = new CubeLayerController(map, options);
  return {
    setQuery: (query) => layer.setQuery(query),
    collection: () => layer.collection(),
    cellAt: (point) => layer.cellAt(point),
    findCell: (point, level) => layer.findCell(point, level),
    levelAt: (zoom, lat) => layer.levelAt(zoom, lat),
    redraw: () => layer.redraw(),
    destroy: () => layer.destroy(),
  };
}
