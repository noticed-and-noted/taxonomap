/**
 * Which layer fills the map's hexes: GBIF's tiles (occLayer.ts), or the pre-counted cubes (cubeLayer.ts)
 * when the cube setting is on and the router (lib/cubes/route.ts) says they can serve the view. The
 * cube code and files load the first time they're needed. If the cubes can't be read, the map goes back
 * to GBIF's tiles until the setting is switched again.
 */
import type { OccurrenceFilter } from '~/lib/gbif';
import type { CubeSet } from '~/lib/cubes/reader';
import { cubeQueryFor, cubesCanServe, type CubeQuery, type TaxonLookup } from '~/lib/cubes/route';
import type { CubeLayer } from './cubeLayer';
import type { OccLayer } from './occLayer';

/** The opened cubes, and a way to start a cube layer on them. */
export interface CubeKit {
  cubes: CubeSet;
  createLayer: (query: CubeQuery, onFailed: () => void) => CubeLayer;
}

/** Where the hexes come from now: GBIF, the cubes (with the share of the snapshot they hold), or GBIF after the cubes failed. */
export type HexSourceState = { kind: 'gbif' } | { kind: 'cubes'; sampleShare: number } | { kind: 'cubes-failed' };

/** What the hex source reads from the app and how it starts layers. */
export interface HexSourceOptions {
  createGbifLayer: () => OccLayer;
  /** Loads the cube code and opens the cubes (cached by the caller). */
  loadCubes: () => Promise<CubeKit>;
  isCubesOn: () => boolean;
  filter: () => OccurrenceFilter;
  zoom: () => number;
  lookup: TaxonLookup;
  onState: (state: HexSourceState) => void;
}

/** Handle on the map's current hex layer. */
export interface HexSource {
  /** The layer drawing the hexes now; none until the first update has picked one. */
  layer(): OccLayer | undefined;
  /** Pick the layer again, after the filter, the zoom or the cube setting changed. */
  update(): Promise<void>;
  /** Forget an earlier cube failure (the setting was switched) and pick again. */
  retry(): Promise<void>;
  destroy(): void;
}

const sameQuery = (left: CubeQuery, right: CubeQuery) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Swaps layers as the view and setting call for; see the file comment. No layer starts until the first
 * update has picked one, so a view the cubes serve never loads GBIF's tiles first.
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
    const { filter, zoom, isCubesOn } = this.#options;
    if (this.#hasFailed || !isCubesOn() || !cubesCanServe(filter(), zoom())) return this.#useGbif();
    let kit: CubeKit;
    let query: CubeQuery | null;
    try {
      kit = await this.#options.loadCubes();
      query = await cubeQueryFor(filter(), zoom(), this.#options.lookup);
    } catch {
      // No cubes at the configured address (not running, or moved): GBIF's tiles carry on.
      if (seq === this.#updateSeq) this.#fail();
      return;
    }
    if (seq !== this.#updateSeq) return;
    if (query) this.#useCubes(kit, query);
    else this.#useGbif();
  }

  retry() {
    this.#hasFailed = false;
    return this.update();
  }

  #useGbif() {
    if (this.#layer && !this.#cubeLayer) return;
    this.#layer?.destroy();
    this.#cubeLayer = null;
    this.#query = null;
    this.#layer = this.#options.createGbifLayer();
    this.#options.onState(this.#hasFailed ? { kind: 'cubes-failed' } : { kind: 'gbif' });
  }

  #useCubes(kit: CubeKit, query: CubeQuery) {
    if (this.#cubeLayer) {
      if (!sameQuery(query, this.#query!)) this.#cubeLayer.setQuery(query);
      this.#query = query;
      return;
    }
    this.#layer?.destroy();
    this.#query = query;
    this.#cubeLayer = kit.createLayer(query, () => this.#fail());
    this.#layer = this.#cubeLayer;
    this.#options.onState({ kind: 'cubes', sampleShare: 1 / kit.cubes.scale });
  }

  #fail() {
    this.#hasFailed = true;
    this.#useGbif();
    this.#options.onState({ kind: 'cubes-failed' });
  }

  destroy() {
    this.#updateSeq++;
    this.#layer?.destroy();
  }
}

/**
 * Prepares to fill the map's hexes; the first update() starts the layer the view calls for.
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
