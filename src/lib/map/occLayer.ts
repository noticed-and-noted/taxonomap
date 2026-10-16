/**
 * Keeps the map's occurrence hexes filled for the view: one grid level
 * (see gridLevel), the GBIF tiles covering what is on screen at that level,
 * merged into cells (see occGrid.ts).
 *
 * Panning fetches newly visible tiles at the same level, shown as they
 * arrive. A new level or new filters swap the whole set once it is ready,
 * so the old hexes stay up until then.
 */
import type { Map as MlMap } from 'maplibre-gl';
import pLimit from 'p-limit';
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
  tilesFor,
  type Hex,
  type LngLat,
  type TileId,
} from './occGrid';

/** Decoded tiles kept for panning back (the cells of a few screens). */
const CACHE_TILES = 256;
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
  /** New cells to draw. */
  onCells: (fc: GeoJSON.FeatureCollection<GeoJSON.Polygon>) => void;
  /** The grid level changed (zooming). */
  onLevel: (level: number) => void;
  /** Tiles in the current burst: done of total. */
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

export function createOccLayer(map: MlMap, o: OccLayerOptions): OccLayer {
  const levelNow = () =>
    gridLevel(map.getZoom(), map.getCenter().lat, map.getCanvas().clientWidth, map.getCanvas().clientHeight);
  let level = levelNow();
  o.onLevel(level);
  let cells = new Map<string, Hex>();
  let shownKey = '';
  let seq = 0;
  let abort = new AbortController();
  const cache = new Map<string, Hex[]>();
  const limit = pLimit(8);

  /** Which hexes: the filters (the tile path and query, whichever host serves it) and level. */
  const setKey = () =>
    `${occurrenceTileTemplate(o.filter(), { hexPerTile: HEX_PER_TILE }, 'mvt').split('/v2/map/')[1]}|${level}`;

  /** Points across the view, centre first, skipping any off the globe. */
  function viewPoints(): LngLat[] {
    const c = map.getCanvas();
    const w = c.clientWidth;
    const h = c.clientHeight;
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

  function show(key: string, tiles: TileId[]) {
    shownKey = key;
    cells = mergeHexes(tiles.map((t) => cache.get(`${key}|${t.x}/${t.y}`) ?? []));
    o.onCells(collection());
  }

  async function update() {
    const mine = ++seq;
    const key = setKey();
    const l = level;
    const tiles = tilesFor(viewPoints(), l);
    const swap = key !== shownKey;
    if (swap) {
      abort.abort();
      abort = new AbortController();
    }
    const signal = abort.signal;
    const missing = tiles.filter((t) => !cache.has(`${key}|${t.x}/${t.y}`));
    let done = 0;
    o.onProgress(0, missing.length);
    if (!swap) show(key, tiles);
    await Promise.all(
      missing.map((t) =>
        limit(async () => {
          if (signal.aborted) return;
          const hexes = await fetchTile(t, l, signal);
          if (hexes) {
            cache.set(`${key}|${t.x}/${t.y}`, hexes);
            if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value!);
          }
          if (signal.aborted || mine !== seq) return;
          o.onProgress(++done, missing.length);
          // Panning: show tiles as they come. A new set waits until it is whole.
          if (!swap) show(key, tiles);
        }),
      ),
    );
    if (mine === seq && !signal.aborted) {
      if (swap) show(key, tiles);
      o.onProgress(missing.length, missing.length);
    }
  }

  const onMoveEnd = () => {
    const next = levelNow();
    if (next !== level) {
      level = next;
      o.onLevel(level);
    }
    void update();
  };
  map.on('moveend', onMoveEnd);
  const offFilter = o.listenFilter(() => void update());
  // Edge went down or came back: refetch what failed.
  const offEdge = onEdgeChange(() => void update());
  if (map.loaded()) void update();
  else map.once('load', () => void update());

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
      map.off('moveend', onMoveEnd);
      offFilter();
      offEdge();
    },
  };
}
