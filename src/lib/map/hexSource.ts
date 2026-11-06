/**
 * Which layer fills the map's hexes: GBIF's tiles (occLayer.ts), or, in cube mode, always the pre-counted
 * cubes (cubeLayer.ts). Cube mode never falls back to GBIF: if the cubes can't be read, or a taxon is one
 * they don't hold, the map shows no hexes and says why. The cube code and files load the first time
 * they're needed.
 */
import type { CubeSet } from '~/lib/cubes/reader';
import { cubeQueryFor, type CubeQuery, type TaxonLookup } from '~/lib/cubes/route';
import type { OccurrenceFilter } from '~/lib/gbif';
import type { CubeLayer } from './cubeLayer';
import type { OccLayer } from './occLayer';

/** The opened cubes, and a way to start a cube layer on them. */
export interface CubeKit {
  cubes: CubeSet;
  createLayer: (query: CubeQuery, onFailed: () => void) => CubeLayer;
}

/**
 * Where the hexes come from now: GBIF; the cubes (with what the bake read); or nothing, in cube mode,
 * because the cubes can't be read or a selected taxon isn't in them (a subspecies, say).
 */
export type HexSourceState =
  | { kind: 'gbif' }
  | { kind: 'cubes'; snapshot: string; partsRead: number; partsTotal: number }
  | { kind: 'cubes-failed' }
  | { kind: 'cubes-unsupported' };

/** What the hex source reads from the app and how it starts layers. */
export interface HexSourceOptions {
  createGbifLayer: () => OccLayer;
  /** Loads the cube code and opens the cubes (cached by the caller). */
  loadCubes: () => Promise<CubeKit>;
  isCubesOn: () => boolean;
  filter: () => OccurrenceFilter;
  lookup: TaxonLookup;
  onState: (state: HexSourceState) => void;
}

/** Handle on the map's current hex layer. */
export interface HexSource {
  /** The layer drawing the hexes now; none until the first update, or while cube mode can't draw. */
  layer(): OccLayer | undefined;
  /** Pick the layer again, after the filter or the cube setting changed. */
  update(): Promise<void>;
  /** Forget an earlier cube failure (the setting was switched) and pick again. */
  retry(): Promise<void>;
  destroy(): void;
}

const sameQuery = (left: CubeQuery, right: CubeQuery) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Swaps layers as the filters and setting call for; see the file comment. No layer starts until the
 * first update has picked one, so cube mode never loads GBIF's tiles first.
 */
class HexSourceController {
  readonly #options: HexSourceOptions;
  #layer: OccLayer | undefined;
  #cubeLayer: CubeLayer | null = null;
  #query: CubeQuery | null = null;
  #hasFailed = false;
  /** Bumped by every update, so a slow lookup finishing after a newer update is dropped. */
  #updateSeq = 0;

  constructor(options: HexSourceOptions) {
    this.#options = options;
  }

  layer() {
    return this.#layer;
  }

  async update() {
    const seq = ++this.#updateSeq;
    if (!this.#options.isCubesOn()) return this.#useGbif();
    if (this.#hasFailed) return;
    let kit: CubeKit;
    let query: CubeQuery | null;
    try {
      kit = await this.#options.loadCubes();
      query = await cubeQueryFor(this.#options.filter(), this.#options.lookup);
    } catch {
      // No cubes at the configured address (not running, or moved): cube mode says so rather than use GBIF.
      if (seq === this.#updateSeq) this.#fail();
      return;
    }
    if (seq !== this.#updateSeq) return;
    if (query) this.#useCubes(kit, query);
    else this.#clear({ kind: 'cubes-unsupported' });
  }

  retry() {
    this.#hasFailed = false;
    return this.update();
  }

  #clear(state: HexSourceState) {
    this.#layer?.destroy();
    this.#layer = undefined;
    this.#cubeLayer = null;
    this.#query = null;
    this.#options.onState(state);
  }

  #useGbif() {
    this.#hasFailed = false;
    if (this.#layer && !this.#cubeLayer) return;
    this.#clear({ kind: 'gbif' });
    this.#layer = this.#options.createGbifLayer();
  }

  #useCubes(kit: CubeKit, query: CubeQuery) {
    if (this.#cubeLayer) {
      if (!sameQuery(query, this.#query!)) this.#cubeLayer.setQuery(query);
      this.#query = query;
      return;
    }
    const { snapshot, partsRead, partsTotal } = kit.cubes;
    this.#clear({ kind: 'cubes', snapshot, partsRead, partsTotal });
    this.#query = query;
    this.#cubeLayer = kit.createLayer(query, () => this.#fail());
    this.#layer = this.#cubeLayer;
  }

  #fail() {
    this.#hasFailed = true;
    this.#clear({ kind: 'cubes-failed' });
  }

  destroy() {
    this.#updateSeq++;
    this.#layer?.destroy();
  }
}

/**
 * Prepares to fill the map's hexes; the first update() starts the layer the setting calls for.
 * @param options How to start each layer, what to read, and where to report the source.
 * @returns A handle for the current layer, updates and stopping.
 */
export function createHexSource(options: HexSourceOptions): HexSource {
  const source = new HexSourceController(options);
  return {
    layer: () => source.layer(),
    update: () => source.update(),
    retry: () => source.retry(),
    destroy: () => source.destroy(),
  };
}
