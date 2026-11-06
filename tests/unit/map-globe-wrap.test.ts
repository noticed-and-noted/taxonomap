/** Re-wrapping globe tiles to the world copy nearest the map's centre. */
import { keepGlobeTilesOnWrapJumps, nearestWrap } from '~/lib/map/globeWrap';

describe('nearestWrap', () => {
  it('keeps tiles within half a world of the centre in its own copy', () => {
    // Zoom 2: four columns, 90° each.
    expect(nearestWrap(-100, 0, 2)).toBe(0);
    expect(nearestWrap(-100, 2, 2)).toBe(0);
  });

  it('takes the copy across the antimeridian when that one is nearer', () => {
    expect(nearestWrap(-170, 3, 2)).toBe(-1);
    expect(nearestWrap(170, 0, 2)).toBe(1);
  });

  it('moves only the tiles whose nearest copy changes when the centre flips by 180° over a pole', () => {
    const columns = [0, 1, 2, 3];
    expect(columns.map((column) => nearestWrap(-100, column, 2))).toEqual([0, 0, 0, -1]);
    expect(columns.map((column) => nearestWrap(81, column, 2))).toEqual([1, 0, 0, 0]);
  });
});

describe('keepGlobeTilesOnWrapJumps', () => {
  /** Runs the fix against a map whose style holds just this tile manager. */
  function patchThrough(manager: object) {
    let onStyleData = () => {};
    const map = {
      style: { tileManagers: { hexes: manager } },
      on: (_event: string, listener: () => void) => (onStyleData = listener),
      off: () => {},
    };
    keepGlobeTilesOnWrapJumps(map as unknown as Parameters<typeof keepGlobeTilesOnWrapJumps>[0]);
    onStyleData();
  }

  it('leaves MapLibre alone when its tile manager no longer has the expected internals', () => {
    class RenamedTileManager {
      transform = {};
      handleWrapJump() {}
    }
    const originalWrapJump = RenamedTileManager.prototype.handleWrapJump;
    patchThrough(new RenamedTileManager());
    expect(RenamedTileManager.prototype.handleWrapJump).toBe(originalWrapJump);
  });
});

describe('keepGlobeTilesOnWrapJumps on a matching tile manager', () => {
  /** A tile id as MapLibre keys it: the wrap is part of the key. */
  function tileId(column: number, zoom: number, wrap: number) {
    return {
      canonical: { x: column, z: zoom },
      wrap,
      key: `${wrap}/${zoom}/${column}`,
      unwrapTo: (newWrap: number) => tileId(column, zoom, newWrap),
    };
  }

  function makeManagerClass() {
    return class TileManager {
      transform: { isGlobeRendering?: boolean } = { isGlobeRendering: true };
      _prevLng?: number;
      _inViewTiles = { _tiles: {} as Record<string, { tileID: ReturnType<typeof tileId> }> };
      resets = 0;
      flatJumps: number[] = [];
      _resetTileReloadTimers() {
        this.resets += 1;
      }
      handleWrapJump(lng: number) {
        this.flatJumps.push(lng);
      }
    };
  }

  function mapWith(managers: Record<string, object> | undefined) {
    const listeners: (() => void)[] = [];
    const map = {
      style: { tileManagers: managers },
      on: (_event: string, listener: () => void) => listeners.push(listener),
      off: (_event: string, listener: () => void) => listeners.splice(listeners.indexOf(listener), 1),
    };
    keepGlobeTilesOnWrapJumps(map as unknown as Parameters<typeof keepGlobeTilesOnWrapJumps>[0]);
    return { map, fire: () => [...listeners].forEach((listener) => listener()), listeners };
  }

  it('waits for the style to have a tile manager', () => {
    const { map, fire, listeners } = mapWith(undefined);
    fire();
    expect(listeners).toHaveLength(1);
    map.style.tileManagers = {};
    fire();
    expect(listeners).toHaveLength(1);
  });

  it('re-wraps globe tiles to the copy nearest the centre, and patches the class once', () => {
    const TileManager = makeManagerClass();
    const manager = new TileManager();
    const { fire, listeners } = mapWith({ hexes: manager });
    fire();
    expect(listeners).toHaveLength(0);
    const patched = TileManager.prototype.handleWrapJump;
    mapWith({ hexes: new TileManager() }).fire();
    expect(TileManager.prototype.handleWrapJump).toBe(patched);

    manager._inViewTiles._tiles = { a: { tileID: tileId(0, 2, 0) }, b: { tileID: tileId(3, 2, 0) } };
    manager.handleWrapJump(170);
    expect(manager._prevLng).toBe(170);
    expect(Object.keys(manager._inViewTiles._tiles).sort()).toEqual(['0/2/3', '1/2/0']);
    expect(manager.resets).toBe(1);

    manager.handleWrapJump(170);
    expect(manager.resets).toBe(1);
  });

  it('keeps MapLibre’s own wrap jump on the flat map', () => {
    const TileManager = makeManagerClass();
    const manager = new TileManager();
    mapWith({ hexes: manager }).fire();
    manager.transform.isGlobeRendering = false;
    manager.handleWrapJump(42);
    expect(manager.flatJumps).toEqual([42]);
  });
});
