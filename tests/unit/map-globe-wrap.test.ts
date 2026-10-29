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
