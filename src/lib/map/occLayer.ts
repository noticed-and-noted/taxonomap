/**
 * Keeps the map's occurrence hexes filled for the view: one grid level
 * (see gridLevel), the GBIF tiles covering what is on screen at that level,
 * merged into cells (see occGrid.ts).
 *
 * Loading stays ahead of panning:
 * - the view's tiles load first, then a ring of tiles around them, so a short
 *   pan lands on cells already drawn;
 * - while you drag, the view is re-planned every MOVE_EVERY_MS rather than
 *   once you let go;
 * - an inertia glide or a flight (easeTo/flyTo) starts loading where it will
 *   end as soon as it starts.
 * Tiles are decoded off the main thread (hexDecoder.ts). The ring's cells are
 * drawn too, a frame after a new set, so a pan reveals cells already on the map,
 * and drawn tiles linger a little past the ring, so panning back resends nothing.
 * Cells arriving for the view are passed on as changes (onChanges); a new
 * level or new filters swap the whole set once its view is loaded (onCells),
 * so the old hexes stay up until then.
 */
import type { EaseToOptions, FlyToOptions, LngLatLike, Map as MlMap, PointLike } from 'maplibre-gl';
import { $gbifStale, countRequest, needsAdhoc, occurrenceTileTemplate, type TileFilter } from '~/lib/gbif';
import { decodeOffThread } from './hexDecoder';
import {
  adhocLevel,
  gridLevel,
  HEX_PER_TILE,
  mergeHexes,
  ringAround,
  shiftTiles,
  tileAt,
  tileCoordinateKey,
  tileDistance,
  tilePoints,
  tilesFor,
  type Hex,
  type LngLat,
  type TileId,
} from './occGrid';
import { isOnScreen, placeAt } from './screen';

/** Decoded tiles kept for panning back (the cells of a few screens). */
const CACHE_TILES = 512;
/** Tile requests in flight at once. */
const CONCURRENCY = 8;
/**
 * How often a drag or glide checks which tiles are in view. Cheap (sampling the
 * view); the costly re-plan and draw only follow when the tiles change.
 */
const MOVE_EVERY_MS = 50;
/**
 * Screen points sampled per side to find the tiles in view. A tile is at
 * least 512 px wide at the centre; at the globe's edge it narrows, so sample
 * densely (every ~64 px on a 1000 px map).
 */
const SAMPLES = 17;
/**
 * Drawn tiles stay drawn while within this many tiles of the view, though
 * past the ring: a pan back, or a fling that overshoots the ring, then finds
 * them still on the map instead of sending their cells to MapLibre again.
 */
const LINGER_TILES = 2;
/**
 * New or changed cells sent to MapLibre per frame; the rest follow next frame.
 * Copying cells to its worker blocks the main thread (about 1 ms per 400
 * cells on a fast laptop), so a burst of tiles would otherwise drop frames.
 */
const MAX_CELLS_PER_FRAME = 500;

/** Handle on the occurrence hexes the layer keeps loaded for a map. */
export interface OccLayer {
  /** The cells on the map now, for the `occ` source. */
  collection(): GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  /** The cell containing a point, if any. */
  cellAt(point: LngLat): Hex | undefined;
  /** The cell containing a point at any grid level, wherever it is, loading its tile and the ring around it. */
  findCell(point: LngLat, level: number): Promise<Hex | undefined>;
  /** Draw again, e.g. after `isEmpty` learns of more empty cells. */
  redraw(): void;
  /** Stop loading and restore the map's methods the layer wrapped. */
  destroy(): void;
}

/** What the layer reads from the app and how it reports back. */
export interface OccLayerOptions {
  filter: () => TileFilter;
  /** A whole new set of cells to draw (new level or filters). */
  onCells: (cells: GeoJSON.FeatureCollection<GeoJSON.Polygon>) => void;
  /** Cells to add to the drawn set, and ids to take out (a changed cell is in both). */
  onChanges: (add: Hex[], remove: string[]) => void;
  /** The grid level changed (zooming). */
  onLevel: (level: number) => void;
  /** Tiles being loaded (view, ring and look-ahead): done of total. */
  onProgress: (done: number, total: number) => void;
  /** Cells to leave out, e.g. ones whose exact count is known to be 0. */
  isEmpty?: (hex: Hex) => boolean;
  /** GBIF could not be reached at all. */
  onFailed: () => void;
  /** Subscribe to filter changes; returns an unsubscribe. */
  listenFilter: (onChange: () => void) => () => void;
}

/** Latitude in Mercator y (clamped short of the poles, where it diverges). */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

/** Point in polygon, in Mercator (the map draws cell edges straight there). */
function inside([lng, lat]: LngLat, ring: GeoJSON.Position[]): boolean {
  const py = mercY(lat);
  let hit = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLng, currentLat] = ring[index] as [number, number];
    const [previousLng, previousLat] = ring[previous] as [number, number];
    const currentMercY = mercY(currentLat);
    const previousMercY = mercY(previousLat);
    if (
      currentMercY > py !== previousMercY > py &&
      lng < ((previousLng - currentLng) * (py - currentMercY)) / (previousMercY - currentMercY) + currentLng
    )
      hit = !hit;
  }
  return hit;
}

/** A ring's bounding box in degrees (Mercator keeps latitude order, so it bounds the Mercator shape too). */
function boxOf(ring: GeoJSON.Position[]) {
  const box = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const [lng, lat] of ring as LngLat[]) {
    box.west = Math.min(box.west, lng);
    box.east = Math.max(box.east, lng);
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
  }
  return box;
}

/** The cell containing a point, if any. */
function cellIn(cells: Iterable<Hex>, [lng, lat]: LngLat): Hex | undefined {
  // Called on every mouse move over thousands of cells: the box test skips nearly all of them.
  for (const cell of cells) {
    const ring = cell.geometry.coordinates[0]!;
    const box = boxOf(ring);
    if (lat < box.south || lat > box.north) continue;
    // Cells by the antimeridian keep their vertices unwrapped (past ±180).
    const hit = [lng, lng + 360, lng - 360].some(
      (shifted) => shifted >= box.west && shifted <= box.east && inside([shifted, lat], ring),
    );
    if (hit) return cell;
  }
  return undefined;
}

/** Normalises MapLibre's accepted coordinate shapes to [lng, lat]. */
function toLngLat(coord: LngLatLike): LngLat {
  if (Array.isArray(coord)) return [coord[0], coord[1]];
  return 'lng' in coord ? [coord.lng, coord.lat] : [coord.lon, coord.lat];
}

/** One tile to fetch: which filter and grid level it belongs to, and its cache key. */
interface Job {
  key: string;
  tile: TileId;
  level: number;
}

/** Cache key of a tile for a filter and grid level. */
const tileKey = (filterId: string, level: number, tile: TileId) => `${filterId}|${level}|${tile.x}/${tile.y}`;

const jobFor = (filterId: string, level: number, tile: TileId): Job => ({
  key: tileKey(filterId, level, tile),
  tile,
  level,
});

/** The pixel offset of an easeTo/flyTo `offset` option, which MapLibre accepts as a point or a pair. */
function offsetPixels(offset: PointLike): [number, number] {
  return Array.isArray(offset) ? [offset[0], offset[1]] : [(offset as { x: number }).x, (offset as { y: number }).y];
}

/** Loads GBIF hex tiles for a map and keeps the drawn cells in step with the view; see the file comment. */
class OccLayerController {
  readonly #map: MlMap;
  readonly #options: OccLayerOptions;
  #level: number;
  readonly #cache = new Map<string, Hex[]>();
  /** Fetches under way, by cache key, each with its level and a way to cancel it. */
  readonly #inflight = new Map<string, { level: number; controller: AbortController }>();
  #filterShown = '';
  /** What the view wants: its tiles, the ring around them, at a filter and level. */
  #want: { filter: string; level: number; view: TileId[]; ring: TileId[] };
  /** What is drawn: cells from tiles of this filter and level. */
  #shown = { filter: '', level: -1 };
  #cells = new Map<string, Hex>();
  /** The tiles whose cells are drawn. */
  #drawnTiles: TileId[] = [];
  #high: Job[] = [];
  #low: Job[] = [];
  /** Tiles where the current glide or flight ends: loaded with the view (same level) or after it, until the move ends. */
  #ahead: Job[] = [];
  #later: Job[] = [];
  #running = 0;
  #progress = { done: 0, total: 0, keys: new Set<string>() };
  #isDrawQueued = false;
  #lastMoveAt = 0;
  readonly #easeTo: MlMap['easeTo'];
  readonly #flyTo: MlMap['flyTo'];
  readonly #stopListeningToFilter: () => void;

  constructor(map: MlMap, options: OccLayerOptions) {
    this.#map = map;
    this.#options = options;
    this.#level = this.#levelAt(map.getZoom(), map.getCenter().lat);
    this.#want = { filter: '', level: this.#level, view: [], ring: [] };
    options.onLevel(this.#level);

    this.#easeTo = map.easeTo.bind(map);
    this.#flyTo = map.flyTo.bind(map);
    map.easeTo = ((easeOptions: EaseToOptions & { offset?: PointLike }, data?: unknown) => {
      this.#lookAhead(easeOptions);
      return this.#easeTo(easeOptions, data);
    }) as MlMap['easeTo'];
    map.flyTo = ((flyOptions: FlyToOptions, data?: unknown) => {
      this.#lookAhead(flyOptions);
      return this.#flyTo(flyOptions, data);
    }) as MlMap['flyTo'];

    map.on('move', this.#onMove);
    map.on('moveend', this.#onMoveEnd);
    // A filter can switch between density and adhoc tiles, which can change the level.
    this.#stopListeningToFilter = options.listenFilter(this.#onMoveEnd);
    if (map.loaded()) this.#planView();
    else map.once('load', () => this.#planView());
  }

  #size() {
    const canvas = this.#map.getCanvas();
    return [canvas.clientWidth, canvas.clientHeight] as const;
  }

  #levelAt(zoom: number, lat: number) {
    const hexLevel = gridLevel(zoom, lat, ...this.#size());
    return needsAdhoc(this.#options.filter()) ? adhocLevel(hexLevel) : hexLevel;
  }

  /** Which hexes: the filters (the tile path and query, whichever host serves it). */
  #filterKey() {
    return occurrenceTileTemplate(this.#options.filter(), { hexPerTile: HEX_PER_TILE }, 'mvt').split('/v2/map/')[1]!;
  }

  /** Points across the view, centre first, skipping any off the globe. */
  #viewPoints(): LngLat[] {
    const map = this.#map;
    const [width, height] = this.#size();
    const points: LngLat[] = [[map.getCenter().lng, map.getCenter().lat]];
    for (let column = 0; column < SAMPLES; column++) {
      for (let row = 0; row < SAMPLES; row++) {
        const place = placeAt(map, (width * column) / (SAMPLES - 1), (height * row) / (SAMPLES - 1));
        if (place) points.push(place);
      }
    }
    return points;
  }

  /**
   * The tiles in view. Sampling the screen misses tiles squeezed into a few
   * pixels (past a pole, at the globe's edge), so neighbours of the sampled
   * tiles are tested directly, ring by ring, until none more are on screen.
   * Each ring grows only from the tiles the last one found.
   */
  #viewTiles(): TileId[] {
    const level = this.#level;
    const view = tilesFor(this.#viewPoints(), level);
    const tested = new Set(view.map(tileCoordinateKey));
    let found = view;
    while (found.length) {
      const untested = ringAround(found, level).filter((tile) => !tested.has(tileCoordinateKey(tile)));
      for (const tile of untested) tested.add(tileCoordinateKey(tile));
      found = untested.filter((tile) => tilePoints(tile, level).some((point) => isOnScreen(this.#map, point)));
      view.push(...found);
    }
    return view;
  }

  async #fetchTile(tile: TileId, level: number, signal: AbortSignal): Promise<Hex[] | undefined> {
    const url = occurrenceTileTemplate(this.#options.filter(), { hexPerTile: HEX_PER_TILE }, 'mvt')
      .replace('{z}', String(level))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));
    countRequest('tile');
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch {
      if (signal.aborted) return undefined;
      this.#options.onFailed();
      return undefined;
    }
    if (response.status === 404) return [];
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) $gbifStale.set(true);
      return undefined;
    }
    try {
      return await decodeOffThread(await response.arrayBuffer(), tile, level);
    } catch {
      // Cancelled mid-body (a zoom or new filters), or a tile that would not decode: left unloaded, asked for again next plan.
      return undefined;
    }
  }

  /**
   * The loaded cells of these tiles, less any known to be empty. The ring is
   * always merged in for its home counts.
   */
  #cellsOf(tiles: TileId[]): Map<string, Hex> {
    const { filter, level, ring } = this.#want;
    const hexesOf = (tile: TileId) => this.#cache.get(tileKey(filter, level, tile)) ?? [];
    const isDrawn = new Set(tiles.flatMap(hexesOf).map((hex) => hex.properties.id));
    const merged = mergeHexes([...tiles, ...ring].map(hexesOf));
    const { isEmpty } = this.#options;
    for (const [id, hex] of merged) if (!isDrawn.has(id) || isEmpty?.(hex)) merged.delete(id);
    return merged;
  }

  /** Drawn tiles past the ring that are still loaded and within LINGER_TILES of the view. */
  #lingeringTiles(): TileId[] {
    const { filter, level, view, ring } = this.#want;
    const wanted = new Set([...view, ...ring].map(tileCoordinateKey));
    return this.#drawnTiles.filter(
      (tile) =>
        !wanted.has(tileCoordinateKey(tile)) &&
        this.#cache.has(tileKey(filter, level, tile)) &&
        view.some((viewTile) => tileDistance(tile, viewTile, level) <= LINGER_TILES),
    );
  }

  /**
   * Draw what is loaded for the view: a whole new set (new level or filters),
   * or the changes since last time.
   */
  #draw() {
    const { filter, level } = this.#want;
    if (this.#shown.filter !== filter || this.#shown.level !== level) this.#drawNewSet();
    else this.#drawChanges();
  }

  /**
   * A new set is the view alone, since sending the ring as well roughly
   * triples the copy to MapLibre's worker that stalls a frame on a new level.
   * It waits until its view is whole, so the old hexes stay up until then.
   */
  #drawNewSet() {
    const { filter, level, view } = this.#want;
    if (!view.every((tile) => this.#cache.has(tileKey(filter, level, tile)))) return;
    this.#shown = { filter, level };
    this.#drawnTiles = view;
    this.#cells = this.#cellsOf(view);
    this.#options.onCells(this.collection());
    // The ring follows as changes, next frame.
    this.#drawSoon();
  }

  /**
   * Changes add the ring, so a pan reveals cells already drawn. Removals all
   * go at once (only ids); new and changed cells go up to MAX_CELLS_PER_FRAME
   * at a time, view first.
   */
  #drawChanges() {
    const { view, ring } = this.#want;
    this.#drawnTiles = [...view, ...ring, ...this.#lingeringTiles()];
    const wanted = this.#cellsOf(this.#drawnTiles);
    const remove = [...this.#cells.keys()].filter((id) => !wanted.has(id));
    for (const id of remove) this.#cells.delete(id);
    const add: Hex[] = [];
    for (const [id, hex] of wanted) {
      const had = this.#cells.get(id);
      if (had?.properties.total === hex.properties.total) continue;
      if (add.length === MAX_CELLS_PER_FRAME) {
        this.#drawSoon();
        break;
      }
      if (had) remove.push(id);
      add.push(hex);
      this.#cells.set(id, hex);
    }
    if (add.length || remove.length) this.#options.onChanges(add, remove);
  }

  /** Arrivals are drawn once a frame, so a burst becomes one change. */
  #drawSoon() {
    if (this.#isDrawQueued) return;
    this.#isDrawQueued = true;
    requestAnimationFrame(() => {
      this.#isDrawQueued = false;
      this.#draw();
    });
  }

  /** Starts queued fetches, view tiles first, up to the concurrency limit. */
  #pump() {
    while (this.#running < CONCURRENCY) {
      const job = this.#high.shift() ?? this.#low.shift();
      if (!job) return;
      if (this.#cache.has(job.key) || this.#inflight.has(job.key)) continue;
      this.#startJob(job);
    }
  }

  #startJob(job: Job) {
    this.#running++;
    const controller = new AbortController();
    this.#inflight.set(job.key, { level: job.level, controller });
    const { signal } = controller;
    void this.#fetchTile(job.tile, job.level, signal).then((hexes) => {
      this.#running--;
      if (this.#inflight.get(job.key)?.controller === controller) this.#inflight.delete(job.key);
      if (hexes && !signal.aborted) this.#remember(job.key, hexes);
      if (this.#progress.keys.has(job.key)) {
        this.#progress.done++;
        this.#options.onProgress(this.#progress.done, this.#progress.total);
      }
      this.#drawSoon();
      this.#pump();
    });
  }

  /** Cancels the fetches under way that `isUnwanted` picks; they no longer count as in flight, so they can be asked again. */
  #cancel(isUnwanted: (level: number) => boolean) {
    for (const [key, { level, controller }] of this.#inflight) {
      if (!isUnwanted(level)) continue;
      controller.abort();
      this.#inflight.delete(key);
    }
  }

  /** Keeps a decoded tile, dropping the oldest beyond the cache size. */
  #remember(key: string, hexes: Hex[]) {
    this.#cache.set(key, hexes);
    if (this.#cache.size > CACHE_TILES) this.#cache.delete(this.#cache.keys().next().value!);
  }

  /**
   * Plan loading for these view tiles (and where a glide or flight will end):
   * they go first, then the ring around the view. Queued jobs not started yet
   * are replaced, so a fast drag does not wait behind tiles it has left.
   */
  #plan(view: TileId[]) {
    const filterId = this.#filterKey();
    if (filterId !== this.#filterShown) {
      // New filters: nothing in flight is wanted any more.
      this.#cancel(() => true);
      this.#filterShown = filterId;
    }
    const level = this.#level;
    const ring = ringAround(view, level);
    this.#want = { filter: filterId, level, view, ring };
    const jobs = (tiles: TileId[]) => tiles.map((tile) => jobFor(filterId, level, tile));
    const missing = (queue: Job[]) => queue.filter((job) => !this.#cache.has(job.key) && !this.#inflight.has(job.key));
    const first = [...jobs(view), ...this.#ahead];
    const second = [...jobs(ring), ...this.#later];
    this.#high = missing(first);
    this.#low = missing(second);
    // Every tile this plan fetches (or is still fetching), so the count matches what is loading.
    const keys = new Set([...first, ...second].filter((job) => !this.#cache.has(job.key)).map((job) => job.key));
    this.#progress = { done: 0, total: keys.size, keys };
    this.#options.onProgress(0, this.#progress.total);
    this.#drawSoon();
    this.#pump();
  }

  #planView() {
    this.#plan(this.#viewTiles());
  }

  /** While dragging: re-plan once other tiles come into view, at the level shown (zooming changes it at moveend). */
  readonly #onMove = () => {
    const now = performance.now();
    if (now - this.#lastMoveAt < MOVE_EVERY_MS) return;
    this.#lastMoveAt = now;
    const map = this.#map;
    if (this.#levelAt(map.getZoom(), map.getCenter().lat) !== this.#level) return;
    const view = this.#viewTiles();
    const shown = new Set(this.#want.view.map(tileCoordinateKey));
    const isSameView = view.length === shown.size && view.every((tile) => shown.has(tileCoordinateKey(tile)));
    if (!isSameView) this.#plan(view);
  };

  readonly #onMoveEnd = () => {
    this.#ahead = [];
    this.#later = [];
    const map = this.#map;
    const next = this.#levelAt(map.getZoom(), map.getCenter().lat);
    if (next !== this.#level) {
      // Old-level tiles would hold the fetch slots the new view needs; a flight's look-ahead is at the new level, so it stays.
      this.#cancel((level) => level !== next);
      this.#level = next;
      this.#options.onLevel(next);
    }
    this.#planView();
  };

  /** Where an easeTo/flyTo ends up, as [lng, lat]. */
  #destinationOf(moveOptions: EaseToOptions | FlyToOptions): LngLat {
    const map = this.#map;
    const centre = toLngLat(moveOptions.center ?? map.getCenter());
    if (!moveOptions.offset) return centre;
    // Offset: the target centre ends up that far from the middle of the view.
    const [offsetX, offsetY] = offsetPixels(moveOptions.offset);
    const point = map.project(centre);
    const position = map.unproject([point.x - offsetX, point.y - offsetY]);
    return [position.lng, position.lat];
  }

  /**
   * An inertia glide or flight is starting: load where it will end. At the
   * same level that is the view's tiles moved by the pan; at another level,
   * the tiles around the destination.
   */
  #lookAhead(moveOptions: EaseToOptions | FlyToOptions) {
    const map = this.#map;
    const target = this.#destinationOf(moveOptions);
    const level = this.#levelAt(moveOptions.zoom ?? map.getZoom(), target[1]);
    const filterId = this.#filterKey();
    if (level === this.#level) {
      const from = tileAt([map.getCenter().lng, map.getCenter().lat], level);
      const to = tileAt(target, level);
      const moved = shiftTiles(this.#want.view, to.x - from.x, to.y - from.y, level);
      this.#ahead = moved.map((tile) => jobFor(filterId, level, tile));
    } else {
      const around = [tileAt(target, level)];
      this.#later = [...around, ...ringAround(around, level)].map((tile) => jobFor(filterId, level, tile));
    }
    this.#plan(this.#want.view);
  }

  collection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
    return { type: 'FeatureCollection', features: [...this.#cells.values()] };
  }

  cellAt(point: LngLat): Hex | undefined {
    return cellIn(this.#cells.values(), point);
  }

  async findCell(point: LngLat, level: number): Promise<Hex | undefined> {
    const filterId = this.#filterKey();
    const centre = tileAt(point, level);
    // Its neighbours too, so a cell split across a tile edge is merged whole.
    const tiles = [centre, ...ringAround([centre], level)];
    const loaded = await Promise.all(tiles.map((tile) => this.#loadTile(filterId, level, tile)));
    return cellIn(mergeHexes(loaded).values(), point);
  }

  /** A tile's hexes from the cache, or fetched outside the view's queue (none if it fails). */
  async #loadTile(filterId: string, level: number, tile: TileId): Promise<Hex[]> {
    const key = tileKey(filterId, level, tile);
    const cached = this.#cache.get(key);
    if (cached) return cached;
    const hexes = await this.#fetchTile(tile, level, new AbortController().signal);
    if (hexes) this.#remember(key, hexes);
    return hexes ?? [];
  }

  redraw() {
    this.#drawSoon();
  }

  destroy() {
    this.#cancel(() => true);
    this.#map.easeTo = this.#easeTo;
    this.#map.flyTo = this.#flyTo;
    this.#map.off('move', this.#onMove);
    this.#map.off('moveend', this.#onMoveEnd);
    this.#stopListeningToFilter();
  }
}

/**
 * Starts keeping the map's occurrence hexes loaded for its view.
 * @param map The MapLibre map; its easeTo and flyTo are wrapped until `destroy()`.
 * @param options Filter, callbacks for drawing and progress.
 * @returns A handle for reading and redrawing the cells and for stopping.
 */
export function createOccLayer(map: MlMap, options: OccLayerOptions): OccLayer {
  const layer = new OccLayerController(map, options);
  return {
    collection: () => layer.collection(),
    cellAt: (point) => layer.cellAt(point),
    findCell: (point, level) => layer.findCell(point, level),
    redraw: () => layer.redraw(),
    destroy: () => layer.destroy(),
  };
}
