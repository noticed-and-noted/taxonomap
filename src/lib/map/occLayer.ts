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
 * Cells arriving for the view are passed on as changes (onChanges); a new
 * level or new filters swap the whole set once its view is loaded (onCells),
 * so the old hexes stay up until then.
 */
import type { EaseToOptions, FlyToOptions, LngLatLike, Map as MlMap, PointLike } from 'maplibre-gl';
import {
  $gbifStale,
  countRequest,
  isEdgeUrl,
  markEdgeDown,
  occurrenceTileTemplate,
  onEdgeChange,
  type TileFilter,
} from '~/lib/gbif';
import {
  decodeHexes,
  gridLevel,
  HEX_PER_TILE,
  mergeHexes,
  ringAround,
  shiftTiles,
  tileAt,
  tilesFor,
  type Hex,
  type LngLat,
  type TileId,
} from './occGrid';

/** Decoded tiles kept for panning back (the cells of a few screens). */
const CACHE_TILES = 512;
/** Tile requests in flight at once. */
const CONCURRENCY = 8;
/** How often a drag re-plans the tiles it needs. */
const MOVE_EVERY_MS = 200;
/**
 * Screen points sampled per side to find the tiles in view. A tile is at
 * least 512 px wide at the centre; at the globe's edge it narrows, so sample
 * densely (every ~64 px on a 1000 px map).
 */
const SAMPLES = 17;

export interface OccLayer {
  /** The cells on the map now, for the `occ` source. */
  collection(): GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  /** The cell containing a point, if any. */
  cellAt(p: LngLat): Hex | undefined;
  destroy(): void;
}

export interface OccLayerOptions {
  filter: () => TileFilter;
  /** A whole new set of cells to draw (new level or filters). */
  onCells: (fc: GeoJSON.FeatureCollection<GeoJSON.Polygon>) => void;
  /** Cells to add to the drawn set, and ids to take out (a changed cell is in both). */
  onChanges: (add: Hex[], remove: string[]) => void;
  /** The grid level changed (zooming). */
  onLevel: (level: number) => void;
  /** The view's tiles: done of total. */
  onProgress: (done: number, total: number) => void;
  /** GBIF could not be reached at all. */
  onFailed: () => void;
  /** Subscribe to filter changes; returns an unsubscribe. */
  listenFilter: (fn: () => void) => () => void;
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));

/** Point in polygon, in Mercator (the map draws cell edges straight there). */
function inside([x, y]: LngLat, ring: GeoJSON.Position[]): boolean {
  const py = mercY(y);
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i]!;
    const [xj = 0, yj = 0] = ring[j]!;
    const myi = mercY(yi);
    const myj = mercY(yj);
    if (myi > py !== myj > py && x < ((xj - xi) * (py - myi)) / (myj - myi) + xi) hit = !hit;
  }
  return hit;
}

function toLngLat(c: LngLatLike): LngLat {
  if (Array.isArray(c)) return [c[0], c[1]];
  return 'lng' in c ? [c.lng, c.lat] : [c.lon, c.lat];
}

interface Job {
  key: string;
  t: TileId;
  level: number;
}

export function createOccLayer(map: MlMap, o: OccLayerOptions): OccLayer {
  const size = () => [map.getCanvas().clientWidth, map.getCanvas().clientHeight] as const;
  const levelAt = (zoom: number, lat: number) => gridLevel(zoom, lat, ...size());
  let level = levelAt(map.getZoom(), map.getCenter().lat);
  o.onLevel(level);

  /** Which hexes: the filters (the tile path and query, whichever host serves it). */
  const filterKey = () =>
    occurrenceTileTemplate(o.filter(), { hexPerTile: HEX_PER_TILE }, 'mvt').split('/v2/map/')[1] ?? '';
  const tileKey = (f: string, l: number, t: TileId) => `${f}|${l}|${t.x}/${t.y}`;

  const cache = new Map<string, Hex[]>();
  const inflight = new Set<string>();
  let abort = new AbortController();
  let filterShown = '';
  /** What the view wants: its tiles, the ring around them, at a filter and level. */
  let want = { filter: '', level, view: [] as TileId[], ring: [] as TileId[] };
  /** What is drawn: cells from tiles of this filter and level. */
  let shown = { filter: '', level: -1 };
  let cells = new Map<string, Hex>();
  let high: Job[] = [];
  let low: Job[] = [];
  /** Tiles where the current glide or flight ends: loaded with the view (same level) or after it, until the move ends. */
  let ahead: Job[] = [];
  let later: Job[] = [];
  let running = 0;
  let progress = { done: 0, total: 0, keys: new Set<string>() };

  /** Points across the view, centre first, skipping any off the globe. */
  function viewPoints(): LngLat[] {
    const [w, h] = size();
    const pts: LngLat[] = [[map.getCenter().lng, map.getCenter().lat]];
    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < SAMPLES; j++) {
        const x = (w * i) / (SAMPLES - 1);
        const y = (h * j) / (SAMPLES - 1);
        const ll = map.unproject([x, y]);
        // Off the globe, unproject snaps to the horizon, so the point does not round-trip.
        const back = map.project(ll);
        if (Math.hypot(back.x - x, back.y - y) <= 1) pts.push([ll.lng, ll.lat]);
      }
    }
    return pts;
  }

  async function fetchTile(t: TileId, l: number, signal: AbortSignal): Promise<Hex[] | undefined> {
    const url = occurrenceTileTemplate(o.filter(), { hexPerTile: HEX_PER_TILE }, 'mvt')
      .replace('{z}', String(l))
      .replace('{x}', String(t.x))
      .replace('{y}', String(t.y));
    countRequest('tile', url);
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch {
      if (signal.aborted) return undefined;
      // Edge cache failing (outage, CORS-less error page): go straight to GBIF, which refetches.
      if (isEdgeUrl(url)) markEdgeDown();
      else o.onFailed();
      return undefined;
    }
    if (res.status === 404) return [];
    if (!res.ok) {
      if (isEdgeUrl(url) && (res.status === 429 || res.status >= 500)) markEdgeDown();
      else if (res.status === 429 || res.status >= 500) $gbifStale.set(true);
      return undefined;
    }
    return decodeHexes(await res.arrayBuffer(), t, l);
  }

  /** The cells of the wanted tiles that are loaded. */
  function wantedCells(): Map<string, Hex> {
    const tiles = [...want.view, ...want.ring];
    return mergeHexes(tiles.map((t) => cache.get(tileKey(want.filter, want.level, t)) ?? []));
  }

  /** Draw what is loaded for the view: a whole new set, or the changes since last time. */
  function draw() {
    const next = wantedCells();
    if (shown.filter !== want.filter || shown.level !== want.level) {
      // A new set waits until its view is whole, so the old hexes stay up until then.
      if (!want.view.every((t) => cache.has(tileKey(want.filter, want.level, t)))) return;
      shown = { filter: want.filter, level: want.level };
      cells = next;
      o.onCells(collection());
      return;
    }
    const add: Hex[] = [];
    const remove: string[] = [];
    for (const [id, h] of next) {
      const had = cells.get(id);
      if (had?.properties.total === h.properties.total) continue;
      if (had) remove.push(id);
      add.push(h);
    }
    for (const id of cells.keys()) if (!next.has(id)) remove.push(id);
    cells = next;
    if (add.length || remove.length) o.onChanges(add, remove);
  }

  // Arrivals are drawn once a frame, so a burst becomes one change.
  let drawQueued = false;
  function drawSoon() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  function pump() {
    while (running < CONCURRENCY) {
      const job = high.shift() ?? low.shift();
      if (!job) return;
      if (cache.has(job.key) || inflight.has(job.key)) continue;
      running++;
      inflight.add(job.key);
      const signal = abort.signal;
      void fetchTile(job.t, job.level, signal).then((hexes) => {
        running--;
        inflight.delete(job.key);
        if (hexes && !signal.aborted) {
          cache.set(job.key, hexes);
          if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value!);
        }
        if (progress.keys.has(job.key)) {
          progress.done++;
          o.onProgress(progress.done, progress.total);
        }
        drawSoon();
        pump();
      });
    }
  }

  /**
   * Plan loading for these view tiles (and where a glide or flight will end):
   * they go first, then the ring around the view. Queued jobs not started yet
   * are replaced, so a fast drag does not wait behind tiles it has left.
   */
  function plan(view: TileId[]) {
    const f = filterKey();
    if (f !== filterShown) {
      // New filters: nothing in flight is wanted any more.
      abort.abort();
      abort = new AbortController();
      filterShown = f;
    }
    const ring = ringAround(view, level);
    want = { filter: f, level, view, ring };
    const jobs = (tiles: TileId[]) => tiles.map((t) => ({ key: tileKey(f, level, t), t, level }));
    const missing = (js: Job[]) => js.filter((j) => !cache.has(j.key) && !inflight.has(j.key));
    const viewJobs = jobs(view);
    high = missing([...viewJobs, ...ahead]);
    low = missing([...jobs(ring), ...later]);
    const pending = viewJobs.filter((j) => !cache.has(j.key));
    progress = { done: 0, total: pending.length, keys: new Set(pending.map((j) => j.key)) };
    o.onProgress(0, progress.total);
    drawSoon();
    pump();
  }

  const planView = () => plan(tilesFor(viewPoints(), level));

  // While dragging: re-plan now and then, at the level shown (zooming changes it at moveend).
  let lastMove = 0;
  const onMove = () => {
    const now = performance.now();
    if (now - lastMove < MOVE_EVERY_MS) return;
    lastMove = now;
    if (levelAt(map.getZoom(), map.getCenter().lat) === level) planView();
  };
  const onMoveEnd = () => {
    ahead = [];
    later = [];
    const next = levelAt(map.getZoom(), map.getCenter().lat);
    if (next !== level) {
      level = next;
      o.onLevel(level);
    }
    planView();
  };

  /**
   * An inertia glide or flight is starting: load where it will end. At the
   * same level that is the view's tiles moved by the pan; at another level,
   * the tiles around the destination.
   */
  function lookAhead(opts: EaseToOptions | FlyToOptions) {
    let target = toLngLat(opts.center ?? map.getCenter());
    if (opts.offset) {
      // Offset: the target centre ends up that far from the middle of the view.
      const [ox, oy] = Array.isArray(opts.offset)
        ? opts.offset
        : [(opts.offset as { x: number }).x, (opts.offset as { y: number }).y];
      const p = map.project(target);
      const ll = map.unproject([p.x - ox, p.y - oy]);
      target = [ll.lng, ll.lat];
    }
    const l = levelAt(opts.zoom ?? map.getZoom(), target[1]);
    const f = filterKey();
    if (l === level) {
      const from = tileAt([map.getCenter().lng, map.getCenter().lat], l);
      const to = tileAt(target, l);
      const moved = shiftTiles(want.view, to.x - from.x, to.y - from.y, l);
      ahead = moved.map((t) => ({ key: tileKey(f, l, t), t, level: l }));
    } else {
      const around = [tileAt(target, l)];
      later = [...around, ...ringAround(around, l)].map((t) => ({ key: tileKey(f, l, t), t, level: l }));
    }
    plan(want.view);
  }
  const easeTo = map.easeTo.bind(map);
  const flyTo = map.flyTo.bind(map);
  map.easeTo = ((opts: EaseToOptions & { offset?: PointLike }, data?: unknown) => {
    lookAhead(opts);
    return easeTo(opts, data);
  }) as MlMap['easeTo'];
  map.flyTo = ((opts: FlyToOptions, data?: unknown) => {
    lookAhead(opts);
    return flyTo(opts, data);
  }) as MlMap['flyTo'];

  map.on('move', onMove);
  map.on('moveend', onMoveEnd);
  const offFilter = o.listenFilter(planView);
  // Edge went down or came back: refetch what failed.
  const offEdge = onEdgeChange(planView);
  if (map.loaded()) planView();
  else map.once('load', planView);

  function collection(): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
    return { type: 'FeatureCollection', features: [...cells.values()] };
  }

  return {
    collection,
    cellAt([lng, lat]) {
      for (const c of cells.values()) {
        const ring = c.geometry.coordinates[0] ?? [];
        // Cells by the antimeridian keep their vertices unwrapped (past ±180).
        if (inside([lng, lat], ring) || inside([lng + 360, lat], ring) || inside([lng - 360, lat], ring)) return c;
      }
      return undefined;
    },
    destroy() {
      abort.abort();
      map.easeTo = easeTo;
      map.flyTo = flyTo;
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      offFilter();
      offEdge();
    },
  };
}
