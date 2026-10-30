/**
 * The map's occurrence layer: which tiles it asks for and in what order,
 * when it swaps in a new set of cells or passes on changes, and how it
 * reacts to drags, flights, filter changes and failures. MapLibre is
 * replaced by a flat Web Mercator map with the same methods.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { $gbifStale, type TileFilter } from '~/lib/gbif';
import { tileAt } from '~/lib/map/occGrid';
import { createOccLayer as create, type OccLayer } from '~/lib/map/occLayer';
import { hexAt, mvt } from './helpers/tiles';

const WIDTH = 1024;
const HEIGHT = 768;
const LAT_LIMIT = 85.0511;

/** A map W × H px, centred on `center` at `zoom`, that fires its events on demand. */
function fakeMap(options: { zoom?: number; center?: [number, number]; loaded?: boolean } = {}) {
  let zoom = options.zoom ?? 4;
  let center = options.center ?? [0, 0];
  const handlers = new Map<string, Set<() => void>>();
  const size = () => 512 * 2 ** zoom;
  const world = ([lng, lat]: [number, number]) => {
    const phi = (Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat)) * Math.PI) / 180;
    return [((lng + 180) / 360) * size(), ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * size()];
  };
  const lngLat = (coord: unknown): [number, number] =>
    Array.isArray(coord) ? [coord[0], coord[1]] : [(coord as { lng: number }).lng, (coord as { lat: number }).lat];
  const easeTo = vi.fn();
  const flyTo = vi.fn();
  const map = {
    getCanvas: () => ({ clientWidth: WIDTH, clientHeight: HEIGHT }),
    getZoom: () => zoom,
    getCenter: () => ({ lng: center[0], lat: center[1] }),
    project(coord: unknown) {
      const [worldX, worldY] = world(lngLat(coord));
      const [centreX, centreY] = world(center);
      return { x: worldX! - centreX! + WIDTH / 2, y: worldY! - centreY! + HEIGHT / 2 };
    },
    // Off the world, the point snaps to its edge (as MapLibre's globe snaps to the horizon).
    unproject([worldX, worldY]: [number, number]) {
      const [centreX, centreY] = world(center);
      const viewX = worldX - WIDTH / 2 + centreX!;
      const viewY = Math.max(0, Math.min(size(), worldY - HEIGHT / 2 + centreY!));
      return {
        lng: (viewX / size()) * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * viewY) / size()))) * 180) / Math.PI,
      };
    },
    on: (eventName: string, handler: () => void) =>
      void (handlers.get(eventName) ?? handlers.set(eventName, new Set()).get(eventName)!).add(handler),
    off: (eventName: string, handler: () => void) => void handlers.get(eventName)?.delete(handler),
    once(eventName: string, handler: () => void) {
      const onceHandler = () => (map.off(eventName, onceHandler), handler());
      map.on(eventName, onceHandler);
    },
    loaded: () => options.loaded ?? true,
    easeTo,
    flyTo,
  };
  return {
    map: map as unknown as MlMap,
    easeTo,
    flyTo,
    moveTo(target: [number, number], nextZoom = zoom) {
      center = target;
      zoom = nextZoom;
    },
    fire: (eventName: string) => [...(handlers.get(eventName) ?? [])].forEach((handler) => handler()),
    listening: (eventName: string) => handlers.get(eventName)?.size ?? 0,
  };
}

/** Layer callbacks, with a filter that can be changed. */
function callbacks(initial: TileFilter = {}) {
  let filter = initial;
  const listeners = new Set<() => void>();
  return {
    o: {
      filter: () => filter,
      onCells: vi.fn<(collection: GeoJSON.FeatureCollection<GeoJSON.Polygon>) => void>(),
      onChanges: vi.fn<(add: { properties: { id: string } }[], remove: string[]) => void>(),
      onLevel: vi.fn(),
      onProgress: vi.fn(),
      onFailed: vi.fn(),
      listenFilter: (callback: () => void) => (listeners.add(callback), () => void listeners.delete(callback)),
    },
    setFilter(next: TileFilter) {
      filter = next;
      listeners.forEach((callback) => callback());
    },
    listeners,
  };
}

interface Asked {
  z: number;
  x: number;
  y: number;
  adhoc: boolean;
  signal: AbortSignal;
}

/** Tile requests, answered by `answer`; a tile with no answer gets one hex at its centre. */
function network(
  answer: (asked: Asked) => Response | ArrayBuffer | Promise<Response | ArrayBuffer> | undefined = () => undefined,
) {
  const asked: Asked[] = [];
  vi.stubGlobal('fetch', async (url: string, requestInit: RequestInit) => {
    const [, kind, zoom, tileX, tileY] = /\/(density|adhoc)\/(\d+)\/(\d+)\/(\d+)\.mvt/.exec(url)!;
    const request = {
      z: Number(zoom),
      x: Number(tileX),
      y: Number(tileY),
      adhoc: kind === 'adhoc',
      signal: requestInit.signal!,
    };
    asked.push(request);
    const out = (await answer(request)) ?? mvt([{ ring: hexAt(2048, 2048), total: 2 * (request.x + 1) }]);
    return out instanceof Response ? out : new Response(out);
  });
  return asked;
}

/** A response held until released; it rejects if its request is aborted first, unless told to ignore that. */
function gate() {
  const held: (() => void)[] = [];
  return {
    hold(asked: Asked, { ignoreAbort = false } = {}) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        held.push(() => resolve(mvt([{ ring: hexAt(2048, 2048), total: 4 }])));
        if (!ignoreAbort)
          asked.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    },
    release: () => held.splice(0).forEach((resolve) => resolve()),
  };
}

/** Let fetches, decoding and the frame-batched draws run (setImmediate, unlike setTimeout, has no 1 ms floor). */
const settle = async () => {
  for (let attempt = 0; attempt < 30; attempt++) await new Promise((resolve) => setImmediate(resolve));
};
const key = (tile: { x: number; y: number }) => `${tile.x}/${tile.y}`;
const ids = (collection: GeoJSON.FeatureCollection) =>
  collection.features.map((feature) => (feature.properties as { id: string }).id).sort();

/** Every layer a test makes, destroyed after it so none keeps loading into the next. */
const layers: OccLayer[] = [];
const createOccLayer = (...args: Parameters<typeof create>) => {
  const layer = create(...args);
  layers.push(layer);
  return layer;
};

// The tile decoder is imported on first use; load it up front so a busy machine can't slow the first test.
beforeAll(async () => {
  await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
});
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setImmediate(callback));
  $gbifStale.set(false);
});
afterEach(() => {
  layers.splice(0).forEach((layer) => layer.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('occurrence layer', () => {
  it('loads the view’s tiles centre first, then the ring around them, and draws them as one set', async () => {
    const asked = network();
    const map = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(map.map, o);
    await settle();
    expect(o.onLevel).toHaveBeenCalledWith(4);
    expect(key(asked[0]!)).toBe('8/8');
    // The view at zoom 4 spans a few tiles each way; the ring adds a tile on every side.
    // Progress counts every tile fetched, view and ring.
    expect(asked.length).toBeGreaterThan(1);
    expect(o.onProgress).toHaveBeenNthCalledWith(1, 0, asked.length);
    expect(o.onProgress).toHaveBeenLastCalledWith(asked.length, asked.length);
    expect(o.onCells).toHaveBeenCalled();
    // The new set is only the view's tiles (asked first); the ring follows as changes.
    const middleOf = (feature: GeoJSON.Feature<GeoJSON.Polygon>): [number, number] => {
      const ring = feature.geometry.coordinates[0]!;
      return [
        ring.reduce((sum, vertex) => sum + vertex[0]!, 0) / ring.length,
        ring.reduce((sum, vertex) => sum + vertex[1]!, 0) / ring.length,
      ];
    };
    const firstSet = o.onCells.mock.calls[0]![0].features;
    expect(firstSet.length).toBeLessThan(new Set(asked.map(key)).size);
    expect(firstSet.map((feature) => key(tileAt(middleOf(feature), 4))).sort()).toEqual(
      asked.slice(0, firstSet.length).map(key).sort(),
    );
    const drawn = layer.collection().features;
    expect(drawn.map((feature) => key(tileAt(middleOf(feature), 4))).sort()).toEqual(asked.map(key).sort());
    const cell = drawn[0]!;
    expect(layer.cellAt(middleOf(cell))).toBe(cell);
    expect(layer.cellAt([170, 0])).toBeUndefined();
    layer.destroy();
  });

  it('finds the cell at a point at any level, wherever it is, from its tile and the ring around it', async () => {
    const asked = network();
    const map = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(map.map, o);
    await settle();
    const level = 7;
    const tile = tileAt([120, 40], level);
    // Each fake tile holds one hex at its centre.
    const tileCount = 2 ** level;
    const centre: [number, number] = [
      ((tile.x + 0.5) / tileCount) * 360 - 180,
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 0.5)) / tileCount))) * 180) / Math.PI,
    ];
    const cell = await layer.findCell(centre, level);
    expect(cell).toBeDefined();
    const atLevel = asked.filter((request) => request.z === level).map(key);
    expect(atLevel).toEqual(expect.arrayContaining([key(tile), key({ x: tile.x + 1, y: tile.y })]));
    expect(atLevel).toHaveLength(9);
    // A second look reuses the loaded tiles; a point between hexes has no cell.
    expect(await layer.findCell([((tile.x + 0.01) / tileCount) * 360 - 180, centre[1]], level)).toBeUndefined();
    expect(asked.filter((request) => request.z === level)).toHaveLength(9);
  });

  it('says the level it would show at a zoom, coarsened for adhoc filters', () => {
    const callbackSet = callbacks();
    const layer = createOccLayer(fakeMap().map, callbackSet.o);
    expect(layer.levelAt(6.5, 0)).toBe(6);
    callbackSet.setFilter({ hasImage: true });
    expect(layer.levelAt(6.5, 0)).toBe(5);
  });

  it('leaves out cells known to be empty, and drops them on redraw', async () => {
    network();
    const map = fakeMap();
    const empty = new Set<string>();
    const options = {
      ...callbacks().o,
      isEmpty: (hex: { properties: { id: string } }) => empty.has(hex.properties.id),
    };
    const layer = createOccLayer(map.map, options);
    await settle();
    const cell = layer.collection().features[0]!;
    const id = (cell.properties as { id: string }).id;
    empty.add(id);
    layer.redraw();
    await settle();
    expect(options.onChanges).toHaveBeenLastCalledWith([], [id]);
    expect(ids(layer.collection())).not.toContain(id);
    const ring = cell.geometry.coordinates[0]!;
    expect(
      layer.cellAt([
        ring.reduce((sum, vertex) => sum + vertex[0]! / ring.length, 0),
        ring.reduce((sum, vertex) => sum + vertex[1]! / ring.length, 0),
      ]),
    ).toBeUndefined();
  });

  it('skips points off the globe when the whole world is in view', async () => {
    const asked = network();
    const map = fakeMap({ zoom: 0 });
    createOccLayer(map.map, callbacks().o);
    await settle();
    expect(asked.map((tile) => `${tile.z}:${key(tile)}`)).toEqual(['0:0/0']);
  });

  it('keeps the old cells up until the new view has loaded, then passes on only the changes', async () => {
    const held = gate();
    const asked = network((request) => (key(request) === '8/8' ? held.hold(request) : undefined));
    const map = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(map.map, o);
    await settle();
    expect(o.onCells).not.toHaveBeenCalled();
    held.release();
    await settle();
    expect(o.onCells).toHaveBeenCalledOnce();
    const before = new Set(ids(layer.collection()));
    o.onChanges.mockClear();

    // Pan east by a tile (22.5° at level 4): new tiles' cells come in; the west's linger, still near the view.
    map.moveTo([22.5, 0]);
    map.fire('moveend');
    await settle();
    expect(o.onCells).toHaveBeenCalledOnce();
    const added = () => o.onChanges.mock.calls.flatMap(([add]) => add.map((hex) => hex.properties.id));
    const removed = () => o.onChanges.mock.calls.flatMap(([, remove]) => remove);
    expect(added().length).toBeGreaterThan(0);
    expect(removed()).toEqual([]);
    expect(added().some((id) => before.has(id))).toBe(false);

    // Two more tiles east: the far west is now out of reach, and goes.
    map.moveTo([67.5, 0]);
    map.fire('moveend');
    await settle();
    expect(removed().length).toBeGreaterThan(0);
    expect(removed().every((id) => before.has(id))).toBe(true);
    expect(asked.filter((tile) => key(tile) === '8/8')).toHaveLength(1);
  });

  it('sends a burst of new cells a few hundred a frame', async () => {
    // A ring tile (sent as changes, not in the new set) full of hexes: 30 × 30, far more than a frame's share.
    const grid = Array.from({ length: 900 }, (_unused, index) => ({
      ring: hexAt(100 + (index % 30) * 130, 100 + Math.floor(index / 30) * 130, 50),
      total: 2,
    }));
    network((request) => (key(request) === '10/8' ? mvt(grid) : undefined));
    const map = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(map.map, o);
    await settle();
    const batches = o.onChanges.mock.calls.map(([add]) => add.length);
    expect(Math.max(...batches)).toBeLessThanOrEqual(500);
    expect(layer.collection().features.length).toBeGreaterThan(900);
  });

  it('updates a cell whose count changes when a better copy arrives', async () => {
    const held = gate();
    // Centred on tile 8/8: the view is tiles 7–9 each way, the ring 6 and 10.
    // A hex centred in ring tile 10/8 is also in the padding of view tile 9/8, over-counted there.
    network((request) => {
      if (key(request) === '9/8') return mvt([{ ring: hexAt(4196, 2048), total: 60 }]);
      if (key(request) === '10/8') return held.hold(request).then(() => mvt([{ ring: hexAt(100, 2048), total: 20 }]));
      return new ArrayBuffer(0);
    });
    const map = fakeMap({ center: [11.25, -11.18] });
    const { o } = callbacks();
    const layer = createOccLayer(map.map, o);
    await settle();
    expect(o.onCells).toHaveBeenCalledOnce();
    const padded = layer.collection().features[0]!.properties as { id: string; total: number; home: boolean };
    expect(padded).toMatchObject({ total: 30, home: false });
    held.release();
    await settle();
    expect(o.onChanges).toHaveBeenCalledWith(
      [expect.objectContaining({ properties: expect.objectContaining({ total: 10 }) })],
      [padded.id],
    );
    expect(layer.collection().features.map((feature) => (feature.properties as { total: number }).total)).toEqual([10]);
  });

  it('copes with failures: unreachable, throttled, rejected and empty tiles', async () => {
    const asked = network((request) => {
      if (key(request) === '8/8') throw new TypeError('offline');
      if (key(request) === '7/8') return new Response(null, { status: 503 });
      if (key(request) === '8/7') return new Response(null, { status: 400 });
      if (key(request) === '7/7') return new Response(null, { status: 404 });
      return new ArrayBuffer(0);
    });
    const map = fakeMap();
    const { o } = callbacks();
    createOccLayer(map.map, o);
    await settle();
    expect(o.onFailed).toHaveBeenCalledOnce();
    expect($gbifStale.get()).toBe(true);
    // The view is not whole while tiles keep failing, so nothing is drawn.
    expect(o.onCells).not.toHaveBeenCalled();
    // Failed tiles are asked for again next time; the empty and missing ones are kept.
    map.fire('moveend');
    await settle();
    const times = (tileId: string) => asked.filter((tile) => key(tile) === tileId).length;
    expect([times('8/8'), times('7/8'), times('8/7'), times('7/7'), times('9/9')]).toEqual([2, 2, 2, 1, 1]);
  });

  it('waits for the map to load', async () => {
    const asked = network();
    const map = fakeMap({ loaded: false });
    createOccLayer(map.map, callbacks().o);
    await settle();
    expect(asked).toHaveLength(0);
    map.fire('load');
    await settle();
    expect(asked.length).toBeGreaterThan(0);
  });

  it('re-plans during a drag once other tiles are in view, at the level shown', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const map = fakeMap();
    const { o } = callbacks();
    createOccLayer(map.map, o);
    await settle();
    const count = () => asked.length;
    const start = count();

    map.moveTo([60, 0]);
    map.fire('move');
    await settle();
    const afterFirst = count();
    expect(afterFirst).toBeGreaterThan(start);

    // A nudge that keeps the same tiles in view plans nothing.
    const plans = o.onProgress.mock.calls.length;
    now.mockReturnValue(1060);
    map.moveTo([60.01, 0]);
    map.fire('move');
    await settle();
    expect(o.onProgress.mock.calls.length).toBe(plans);

    // Too soon after the last check.
    now.mockReturnValue(1080);
    map.moveTo([120, 0]);
    map.fire('move');
    await settle();
    expect(count()).toBe(afterFirst);

    // Zoomed to another level mid-drag: wait for the move to end.
    now.mockReturnValue(1400);
    map.moveTo([120, 0], 6);
    map.fire('move');
    await settle();
    expect(count()).toBe(afterFirst);

    map.fire('moveend');
    await settle();
    expect(o.onLevel).toHaveBeenLastCalledWith(6);
    expect(asked.at(-1)!.z).toBe(6);
  });

  it('drops tiles of the old filters, at the level the new ones need', async () => {
    const held = gate();
    let holdAll = true;
    const asked = network((request) => {
      if (!holdAll) return undefined;
      // One response arrives after its request was cancelled.
      return held.hold(request, { ignoreAbort: key(request) === '4/4' });
    });
    const map = fakeMap({ zoom: 3 });
    const callbackSet = callbacks();
    createOccLayer(map.map, callbackSet.o);
    await settle();
    const first = [...asked];
    expect(first.every((tile) => tile.z === 3 && !tile.adhoc)).toBe(true);

    holdAll = false;
    // Adhoc tiles at level 3 beat with GBIF's geohash cells: level 2 is used instead.
    callbackSet.setFilter({ hasImage: true });
    await settle();
    expect(first.every((tile) => tile.signal.aborted)).toBe(true);
    expect(callbackSet.o.onLevel).toHaveBeenLastCalledWith(2);
    const next = asked.slice(first.length);
    expect(next.every((tile) => tile.z === 2 && tile.adhoc)).toBe(true);
    held.release();
    await settle();
    expect(callbackSet.o.onCells).toHaveBeenCalledOnce();
    expect(ids(callbackSet.o.onCells.mock.calls[0]![0]).every((id) => id.startsWith('2:'))).toBe(true);
  });

  it('drops tiles of the old level once a zoom ends, keeping a flight’s look-ahead', async () => {
    const held = gate();
    let isHolding = true;
    const asked = network((request) => (isHolding ? held.hold(request) : undefined));
    const map = fakeMap({ zoom: 3 });
    const callbackSet = callbacks();
    createOccLayer(map.map, callbackSet.o);
    await settle();
    const first = [...asked];
    expect(first.every((tile) => tile.z === 3)).toBe(true);

    map.map.flyTo({ center: [0, 0], zoom: 4 });
    await settle();
    map.moveTo([0, 0], 4);
    map.fire('moveend');
    await settle();
    expect(callbackSet.o.onLevel).toHaveBeenLastCalledWith(4);
    expect(first.every((tile) => tile.signal.aborted)).toBe(true);
    const next = asked.slice(first.length);
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((tile) => tile.z === 4 && !tile.signal.aborted)).toBe(true);
    isHolding = false;
    held.release();
    await settle();
    expect(ids(callbackSet.o.onCells.mock.calls.at(-1)![0]).every((id) => id.startsWith('4:'))).toBe(true);
  });

  it('asks for each tile once, however often it is queued', async () => {
    const asked = network(() => new ArrayBuffer(0));
    // Nine tiles in view: eight load at once, the ninth waits its turn.
    const map = fakeMap({ center: [11.25, -11.18] });
    createOccLayer(map.map, callbacks().o);
    // A glide that ends where it starts queues the view's tiles again while they load.
    map.map.easeTo({ center: [11.25, -11.18] });
    await settle();
    const keys = asked.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('starts loading where a glide or flight will end', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const map = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(map.map, o);
    await settle();
    const seen = () => new Set(asked.map((tile) => `${tile.z}:${key(tile)}`));

    // A glide at the same level: the view's tiles shifted by the pan.
    map.map.easeTo({ center: [90, 0] });
    await settle();
    expect(seen()).toContain('4:12/8');
    expect(map.easeTo).toHaveBeenCalledWith({ center: [90, 0] }, undefined);

    // An offset puts the target that far from the middle; a centre can be {lng, lat} or {lon, lat}.
    map.map.easeTo({ center: { lng: -90, lat: 0 }, offset: [256, 0] });
    map.map.easeTo({ offset: { x: 0, y: -256 } } as never);
    map.map.flyTo({ center: { lon: -150, lat: 0 } } as never);
    await settle();
    expect(seen()).toContain('4:1/8');

    // A flight to another level: the tiles around its destination, after the view's.
    map.map.flyTo({ center: [10, 50], zoom: 8 });
    await settle();
    expect(asked.at(-1)!.z).toBe(8);
    expect(map.flyTo).toHaveBeenCalledTimes(2);

    // Once the move ends, those are forgotten.
    map.moveTo([10, 50], 8);
    map.fire('moveend');
    await settle();
    expect(o.onLevel).toHaveBeenLastCalledWith(8);
    layer.destroy();
  });

  it('forgets the oldest tiles past its cache', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const map = fakeMap({ zoom: 8, center: [0, 0] });
    createOccLayer(map.map, callbacks().o);
    await settle();
    const firstTile = key(asked[0]!);
    // Around 25 tiles a view: 30 views well apart pass the 512 kept.
    for (let attempt = 1; attempt <= 30; attempt++) {
      map.moveTo([attempt * 10 - 180, 0]);
      map.fire('moveend');
      await settle();
    }
    map.moveTo([0, 0]);
    map.fire('moveend');
    await settle();
    expect(asked.filter((tile) => tile.z === 8 && key(tile) === firstTile)).toHaveLength(2);
  });

  it('finds cells across the antimeridian, whose vertices run past ±180°', async () => {
    const cellNear = async (tileX: number, px: number, at: number) => {
      network((request) =>
        request.x === tileX && request.y === 8 ? mvt([{ ring: hexAt(px, 1000), total: 2 }]) : new ArrayBuffer(0),
      );
      const map = fakeMap({ center: [179.9, -5] });
      const layer = createOccLayer(map.map, callbacks().o);
      await settle();
      const [cell] = layer.collection().features;
      const lat = cell!.geometry.coordinates[0]!.reduce((sum, vertex) => sum + vertex[1]!, 0) / 7;
      const hit = layer.cellAt([at, lat]);
      layer.destroy();
      return hit === cell;
    };
    // A hex at the east edge of the last tile reaches past 180°; one at the west edge of the first, past -180°.
    expect(await cellNear(15, 4090, -179.9)).toBe(true);
    expect(await cellNear(0, 6, 179.9)).toBe(true);
  });

  it('cancels what is in flight when the filters change at the same level, and when destroyed', async () => {
    const held = gate();
    const asked = network((request) => held.hold(request));
    const map = fakeMap({ zoom: 3 });
    const callbackSet = callbacks();
    const layer = createOccLayer(map.map, callbackSet.o);
    await settle();
    const first = [...asked];

    // One taxon still uses density tiles, so the level stays and only the filters differ.
    callbackSet.setFilter({ taxonKeys: [1] });
    await settle();
    expect(first.every((tile) => tile.signal.aborted)).toBe(true);
    const second = asked.slice(first.length);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((tile) => tile.z === 3 && !tile.adhoc)).toBe(true);
    layer.destroy();
    expect(second.every((tile) => tile.signal.aborted)).toBe(true);
  });

  it('keeps a flight’s look-ahead loading when the move ends at its level', async () => {
    const held = gate();
    let isHolding = true;
    const asked = network((request) => (isHolding && request.z === 4 ? held.hold(request) : new ArrayBuffer(0)));
    const map = fakeMap({ zoom: 3 });
    createOccLayer(map.map, callbacks().o);
    await settle();
    map.map.flyTo({ center: [0, 0], zoom: 4 });
    await settle();
    const lookAhead = asked.filter((tile) => tile.z === 4);
    expect(lookAhead.length).toBeGreaterThan(0);

    map.moveTo([0, 0], 4);
    map.fire('moveend');
    await settle();
    expect(lookAhead.some((tile) => !tile.signal.aborted)).toBe(true);
    isHolding = false;
    held.release();
    await settle();
  });

  it('leaves a tile that will not decode unloaded, and asks for it again', async () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]).buffer;
    const asked = network((request) => (key(request) === '8/8' ? garbage : undefined));
    const map = fakeMap();
    const { o } = callbacks();
    createOccLayer(map.map, o);
    await settle();
    expect(o.onCells).not.toHaveBeenCalled();
    map.fire('moveend');
    await settle();
    expect(asked.filter((tile) => key(tile) === '8/8')).toHaveLength(2);
  });

  it('finds no cell where its tiles fail, and asks for them again next time', async () => {
    const level = 7;
    const point: [number, number] = [120, 40];
    const asked = network((request) => (request.z === level ? new Response(null, { status: 503 }) : undefined));
    const layer = createOccLayer(fakeMap().map, callbacks().o);
    await settle();
    expect(await layer.findCell(point, level)).toBeUndefined();
    await layer.findCell(point, level);
    expect(asked.filter((request) => request.z === level)).toHaveLength(18);
  });

  it('lets go of the map when destroyed', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const map = fakeMap();
    const callbackSet = callbacks();
    const layer = createOccLayer(map.map, callbackSet.o);
    await settle();
    const wrapped = map.map.easeTo;
    layer.destroy();
    expect(map.map.easeTo).not.toBe(wrapped);
    const before = asked.length;
    map.map.easeTo({ center: [90, 0] });
    map.map.flyTo({ center: [90, 0] });
    await settle();
    expect(asked).toHaveLength(before);
    expect([map.easeTo, map.flyTo].map((spy) => spy.mock.calls.length)).toEqual([1, 1]);
    expect([map.listening('move'), map.listening('moveend'), callbackSet.listeners.size]).toEqual([0, 0, 0]);
  });
});
