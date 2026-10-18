/**
 * The map's occurrence layer: which tiles it asks for and in what order,
 * when it swaps in a new set of cells or passes on changes, and how it
 * reacts to drags, flights, filter changes and failures. MapLibre is
 * replaced by a flat Web Mercator map with the same methods.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { $gbifStale, type TileFilter } from '~/lib/gbif';
import { createOccLayer as create, type OccLayer } from '~/lib/map/occLayer';
import { hexAt, mvt } from './helpers/tiles';

const W = 1024;
const H = 768;
const LAT_LIMIT = 85.0511;

/** A map W × H px, centred on `center` at `zoom`, that fires its events on demand. */
function fakeMap(opts: { zoom?: number; center?: [number, number]; loaded?: boolean } = {}) {
  let zoom = opts.zoom ?? 4;
  let center = opts.center ?? [0, 0];
  const handlers = new Map<string, Set<() => void>>();
  const size = () => 512 * 2 ** zoom;
  const world = ([lng, lat]: [number, number]) => {
    const phi = (Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat)) * Math.PI) / 180;
    return [((lng + 180) / 360) * size(), ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * size()];
  };
  const lngLat = (c: unknown): [number, number] =>
    Array.isArray(c) ? [c[0], c[1]] : [(c as { lng: number }).lng, (c as { lat: number }).lat];
  const easeTo = vi.fn();
  const flyTo = vi.fn();
  const map = {
    getCanvas: () => ({ clientWidth: W, clientHeight: H }),
    getZoom: () => zoom,
    getCenter: () => ({ lng: center[0], lat: center[1] }),
    project(c: unknown) {
      const [x, y] = world(lngLat(c));
      const [cx, cy] = world(center);
      return { x: x! - cx! + W / 2, y: y! - cy! + H / 2 };
    },
    // Off the world, the point snaps to its edge (as MapLibre's globe snaps to the horizon).
    unproject([x, y]: [number, number]) {
      const [cx, cy] = world(center);
      const wx = x - W / 2 + cx!;
      const wy = Math.max(0, Math.min(size(), y - H / 2 + cy!));
      return {
        lng: (wx / size()) * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / size()))) * 180) / Math.PI,
      };
    },
    on: (e: string, f: () => void) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(f),
    off: (e: string, f: () => void) => void handlers.get(e)?.delete(f),
    once(e: string, f: () => void) {
      const g = () => (map.off(e, g), f());
      map.on(e, g);
    },
    loaded: () => opts.loaded ?? true,
    easeTo,
    flyTo,
  };
  return {
    map: map as unknown as MlMap,
    easeTo,
    flyTo,
    moveTo(c: [number, number], z = zoom) {
      center = c;
      zoom = z;
    },
    fire: (e: string) => [...(handlers.get(e) ?? [])].forEach((f) => f()),
    listening: (e: string) => handlers.get(e)?.size ?? 0,
  };
}

/** Layer callbacks, with a filter that can be changed. */
function callbacks(initial: TileFilter = {}) {
  let filter = initial;
  const listeners = new Set<() => void>();
  return {
    o: {
      filter: () => filter,
      onCells: vi.fn<(fc: GeoJSON.FeatureCollection) => void>(),
      onChanges: vi.fn<(add: { properties: { id: string } }[], remove: string[]) => void>(),
      onLevel: vi.fn(),
      onProgress: vi.fn(),
      onFailed: vi.fn(),
      listenFilter: (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn)),
    },
    setFilter(next: TileFilter) {
      filter = next;
      listeners.forEach((fn) => fn());
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
  answer: (t: Asked) => Response | ArrayBuffer | Promise<Response | ArrayBuffer> | undefined = () => undefined,
) {
  const asked: Asked[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const [, kind, z, x, y] = /\/(density|adhoc)\/(\d+)\/(\d+)\/(\d+)\.mvt/.exec(url)!;
    const t = { z: Number(z), x: Number(x), y: Number(y), adhoc: kind === 'adhoc', signal: init.signal! };
    asked.push(t);
    const out = (await answer(t)) ?? mvt([{ ring: hexAt(2048, 2048), total: 2 * (t.x + 1) }]);
    return out instanceof Response ? out : new Response(out);
  });
  return asked;
}

/** A response held until released; it rejects if its request is aborted first, unless told to ignore that. */
function gate() {
  const held: (() => void)[] = [];
  return {
    hold(t: Asked, { ignoreAbort = false } = {}) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        held.push(() => resolve(mvt([{ ring: hexAt(2048, 2048), total: 4 }])));
        if (!ignoreAbort) t.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    },
    release: () => held.splice(0).forEach((r) => r()),
  };
}

/** Let fetches, decoding and the frame-batched draws run (setImmediate, unlike setTimeout, has no 1 ms floor). */
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
const key = (t: { x: number; y: number }) => `${t.x}/${t.y}`;
const ids = (fc: GeoJSON.FeatureCollection) => fc.features.map((f) => (f.properties as { id: string }).id).sort();

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
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setImmediate(cb));
  $gbifStale.set(false);
});
afterEach(() => {
  layers.splice(0).forEach((l) => l.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('occurrence layer', () => {
  it('loads the view’s tiles centre first, then the ring around them, and draws them as one set', async () => {
    const asked = network();
    const m = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(m.map, o);
    await settle();
    expect(o.onLevel).toHaveBeenCalledWith(4);
    expect(key(asked[0]!)).toBe('8/8');
    // The view at zoom 4 spans a few tiles each way; the ring adds a tile on every side.
    const view = o.onProgress.mock.calls[0]![1] as number;
    expect(view).toBeGreaterThan(1);
    expect(asked.length).toBeGreaterThan(view);
    expect(o.onProgress).toHaveBeenLastCalledWith(view, view);
    expect(o.onCells).toHaveBeenCalled();
    // Every tile's hex is drawn, view and ring, once it has loaded.
    expect(layer.collection().features).toHaveLength(new Set(asked.map(key)).size);
    const cell = layer.collection().features[0]!;
    const ring = cell.geometry.coordinates[0]!;
    const middle: [number, number] = [
      ring.reduce((s, p) => s + p[0]!, 0) / ring.length,
      ring.reduce((s, p) => s + p[1]!, 0) / ring.length,
    ];
    expect(layer.cellAt(middle)).toBe(cell);
    expect(layer.cellAt([170, 0])).toBeUndefined();
    layer.destroy();
  });

  it('leaves out cells known to be empty, and drops them on redraw', async () => {
    network();
    const m = fakeMap();
    const empty = new Set<string>();
    const o = { ...callbacks().o, isEmpty: (h: { properties: { id: string } }) => empty.has(h.properties.id) };
    const layer = createOccLayer(m.map, o);
    await settle();
    const cell = layer.collection().features[0]!;
    const id = (cell.properties as { id: string }).id;
    empty.add(id);
    layer.redraw();
    await settle();
    expect(o.onChanges).toHaveBeenLastCalledWith([], [id]);
    expect(ids(layer.collection())).not.toContain(id);
    const ring = cell.geometry.coordinates[0]!;
    expect(
      layer.cellAt([
        ring.reduce((s, p) => s + p[0]! / ring.length, 0),
        ring.reduce((s, p) => s + p[1]! / ring.length, 0),
      ]),
    ).toBeUndefined();
  });

  it('skips points off the globe when the whole world is in view', async () => {
    const asked = network();
    const m = fakeMap({ zoom: 0 });
    createOccLayer(m.map, callbacks().o);
    await settle();
    expect(asked.map((t) => `${t.z}:${key(t)}`)).toEqual(['0:0/0']);
  });

  it('keeps the old cells up until the new view has loaded, then passes on only the changes', async () => {
    const g = gate();
    const asked = network((t) => (key(t) === '8/8' ? g.hold(t) : undefined));
    const m = fakeMap();
    const { o } = callbacks();
    createOccLayer(m.map, o);
    await settle();
    expect(o.onCells).not.toHaveBeenCalled();
    g.release();
    await settle();
    expect(o.onCells).toHaveBeenCalledOnce();
    const before = new Set(ids(o.onCells.mock.calls[0]![0]));

    // Pan east by a tile: new tiles' cells come in, the far west's go.
    m.moveTo([22.5, 0]);
    m.fire('moveend');
    await settle();
    expect(o.onCells).toHaveBeenCalledOnce();
    const added = o.onChanges.mock.calls.flatMap(([add]) => add.map((h) => h.properties.id));
    const removed = o.onChanges.mock.calls.flatMap(([, remove]) => remove);
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((id) => before.has(id))).toBe(true);
    expect(added.some((id) => before.has(id))).toBe(false);
    expect(asked.filter((t) => key(t) === '8/8')).toHaveLength(1);
  });

  it('updates a cell whose count changes when a better copy arrives', async () => {
    const g = gate();
    // Centred on tile 8/8: the view is tiles 7–9 each way, the ring 6 and 10.
    // A hex centred in ring tile 10/8 is also in the padding of view tile 9/8, over-counted there.
    network((t) => {
      if (key(t) === '9/8') return mvt([{ ring: hexAt(4196, 2048), total: 60 }]);
      if (key(t) === '10/8') return g.hold(t).then(() => mvt([{ ring: hexAt(100, 2048), total: 20 }]));
      return new ArrayBuffer(0);
    });
    const m = fakeMap({ center: [11.25, -11.18] });
    const { o } = callbacks();
    const layer = createOccLayer(m.map, o);
    await settle();
    expect(o.onCells).toHaveBeenCalledOnce();
    const padded = layer.collection().features[0]!.properties as { id: string; total: number; home: boolean };
    expect(padded).toMatchObject({ total: 30, home: false });
    g.release();
    await settle();
    expect(o.onChanges).toHaveBeenCalledWith(
      [expect.objectContaining({ properties: expect.objectContaining({ total: 10 }) })],
      [padded.id],
    );
    expect(layer.collection().features.map((f) => (f.properties as { total: number }).total)).toEqual([10]);
  });

  it('copes with failures: unreachable, throttled, rejected and empty tiles', async () => {
    const asked = network((t) => {
      if (key(t) === '8/8') throw new TypeError('offline');
      if (key(t) === '7/8') return new Response(null, { status: 503 });
      if (key(t) === '8/7') return new Response(null, { status: 400 });
      if (key(t) === '7/7') return new Response(null, { status: 404 });
      return new ArrayBuffer(0);
    });
    const m = fakeMap();
    const { o } = callbacks();
    createOccLayer(m.map, o);
    await settle();
    expect(o.onFailed).toHaveBeenCalledOnce();
    expect($gbifStale.get()).toBe(true);
    // The view is not whole while tiles keep failing, so nothing is drawn.
    expect(o.onCells).not.toHaveBeenCalled();
    // Failed tiles are asked for again next time; the empty and missing ones are kept.
    m.fire('moveend');
    await settle();
    const times = (k: string) => asked.filter((t) => key(t) === k).length;
    expect([times('8/8'), times('7/8'), times('8/7'), times('7/7'), times('9/9')]).toEqual([2, 2, 2, 1, 1]);
  });

  it('waits for the map to load', async () => {
    const asked = network();
    const m = fakeMap({ loaded: false });
    createOccLayer(m.map, callbacks().o);
    await settle();
    expect(asked).toHaveLength(0);
    m.fire('load');
    await settle();
    expect(asked.length).toBeGreaterThan(0);
  });

  it('re-plans now and then during a drag, at the level shown', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const m = fakeMap();
    const { o } = callbacks();
    createOccLayer(m.map, o);
    await settle();
    const count = () => asked.length;
    const start = count();

    m.moveTo([60, 0]);
    m.fire('move');
    await settle();
    const afterFirst = count();
    expect(afterFirst).toBeGreaterThan(start);

    // Too soon after the last re-plan.
    now.mockReturnValue(1100);
    m.moveTo([120, 0]);
    m.fire('move');
    await settle();
    expect(count()).toBe(afterFirst);

    // Zoomed to another level mid-drag: wait for the move to end.
    now.mockReturnValue(1400);
    m.moveTo([120, 0], 6);
    m.fire('move');
    await settle();
    expect(count()).toBe(afterFirst);

    m.fire('moveend');
    await settle();
    expect(o.onLevel).toHaveBeenLastCalledWith(6);
    expect(asked.at(-1)!.z).toBe(6);
  });

  it('drops tiles of the old filters, at the level the new ones need', async () => {
    const g = gate();
    let holdAll = true;
    const asked = network((t) => {
      if (!holdAll) return undefined;
      // One response arrives after its request was cancelled.
      return g.hold(t, { ignoreAbort: key(t) === '4/4' });
    });
    const m = fakeMap({ zoom: 3 });
    const c = callbacks();
    createOccLayer(m.map, c.o);
    await settle();
    const first = [...asked];
    expect(first.every((t) => t.z === 3 && !t.adhoc)).toBe(true);

    holdAll = false;
    // Adhoc tiles at level 3 beat with GBIF's geohash cells: level 2 is used instead.
    c.setFilter({ hasImage: true });
    await settle();
    expect(first.every((t) => t.signal.aborted)).toBe(true);
    expect(c.o.onLevel).toHaveBeenLastCalledWith(2);
    const next = asked.slice(first.length);
    expect(next.every((t) => t.z === 2 && t.adhoc)).toBe(true);
    g.release();
    await settle();
    expect(c.o.onCells).toHaveBeenCalledOnce();
    expect(ids(c.o.onCells.mock.calls[0]![0]).every((id) => id.startsWith('2:'))).toBe(true);
  });

  it('asks for each tile once, however often it is queued', async () => {
    const asked = network(() => new ArrayBuffer(0));
    // Nine tiles in view: eight load at once, the ninth waits its turn.
    const m = fakeMap({ center: [11.25, -11.18] });
    createOccLayer(m.map, callbacks().o);
    // A glide that ends where it starts queues the view's tiles again while they load.
    m.map.easeTo({ center: [11.25, -11.18] });
    await settle();
    const keys = asked.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('starts loading where a glide or flight will end', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const m = fakeMap();
    const { o } = callbacks();
    const layer = createOccLayer(m.map, o);
    await settle();
    const seen = () => new Set(asked.map((t) => `${t.z}:${key(t)}`));

    // A glide at the same level: the view's tiles shifted by the pan.
    m.map.easeTo({ center: [90, 0] });
    await settle();
    expect(seen()).toContain('4:12/8');
    expect(m.easeTo).toHaveBeenCalledWith({ center: [90, 0] }, undefined);

    // An offset puts the target that far from the middle; a centre can be {lng, lat} or {lon, lat}.
    m.map.easeTo({ center: { lng: -90, lat: 0 }, offset: [256, 0] });
    m.map.easeTo({ offset: { x: 0, y: -256 } } as never);
    m.map.flyTo({ center: { lon: -150, lat: 0 } } as never);
    await settle();
    expect(seen()).toContain('4:1/8');

    // A flight to another level: the tiles around its destination, after the view's.
    m.map.flyTo({ center: [10, 50], zoom: 8 });
    await settle();
    expect(asked.at(-1)!.z).toBe(8);
    expect(m.flyTo).toHaveBeenCalledTimes(2);

    // Once the move ends, those are forgotten.
    m.moveTo([10, 50], 8);
    m.fire('moveend');
    await settle();
    expect(o.onLevel).toHaveBeenLastCalledWith(8);
    layer.destroy();
  });

  it('forgets the oldest tiles past its cache', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const m = fakeMap({ zoom: 8, center: [0, 0] });
    createOccLayer(m.map, callbacks().o);
    await settle();
    const firstTile = key(asked[0]!);
    // Around 25 tiles a view: 30 views well apart pass the 512 kept.
    for (let i = 1; i <= 30; i++) {
      m.moveTo([i * 10 - 180, 0]);
      m.fire('moveend');
      await settle();
    }
    m.moveTo([0, 0]);
    m.fire('moveend');
    await settle();
    expect(asked.filter((t) => t.z === 8 && key(t) === firstTile)).toHaveLength(2);
  });

  it('finds cells across the antimeridian, whose vertices run past ±180°', async () => {
    const cellNear = async (tileX: number, px: number, at: number) => {
      network((t) => (t.x === tileX && t.y === 8 ? mvt([{ ring: hexAt(px, 1000), total: 2 }]) : new ArrayBuffer(0)));
      const m = fakeMap({ center: [179.9, -5] });
      const layer = createOccLayer(m.map, callbacks().o);
      await settle();
      const [cell] = layer.collection().features;
      const lat = cell!.geometry.coordinates[0]!.reduce((s, p) => s + p[1]!, 0) / 7;
      const hit = layer.cellAt([at, lat]);
      layer.destroy();
      return hit === cell;
    };
    // A hex at the east edge of the last tile reaches past 180°; one at the west edge of the first, past -180°.
    expect(await cellNear(15, 4090, -179.9)).toBe(true);
    expect(await cellNear(0, 6, 179.9)).toBe(true);
  });

  it('lets go of the map when destroyed', async () => {
    const asked = network(() => new ArrayBuffer(0));
    const m = fakeMap();
    const c = callbacks();
    const layer = createOccLayer(m.map, c.o);
    await settle();
    const wrapped = m.map.easeTo;
    layer.destroy();
    expect(m.map.easeTo).not.toBe(wrapped);
    const before = asked.length;
    m.map.easeTo({ center: [90, 0] });
    m.map.flyTo({ center: [90, 0] });
    await settle();
    expect(asked).toHaveLength(before);
    expect([m.easeTo, m.flyTo].map((f) => f.mock.calls.length)).toEqual([1, 1]);
    expect([m.listening('move'), m.listening('moveend'), c.listeners.size]).toEqual([0, 0, 0]);
  });
});
