/**
 * Keeps MapLibre's globe tiles drawn when the map's centre longitude jumps.
 *
 * MapLibre 6 treats any jump of over 180° as a whole-world wrap and moves every
 * loaded tile to the next world copy. On the globe each tile's copy is instead
 * the one nearest the centre, so the moved tiles no longer match the ones the
 * view asks for, and every source redraws from scratch: the hexes blank for a
 * quarter of a second. Panning over a pole flips the centre by ~180°, so it
 * happens on every polar pan. This re-wraps each tile to its nearest copy.
 */
import type { Map as MlMap, OverscaledTileID } from 'maplibre-gl';

/** The parts of MapLibre's (internal) TileManager the fix reads and replaces. */
interface TileManagerInternals {
  /** Set by update() just before it calls handleWrapJump. */
  transform: { isGlobeRendering?: boolean };
  _prevLng?: number;
  _inViewTiles: { _tiles: Record<string, { tileID: OverscaledTileID }> };
  _resetTileReloadTimers(): void;
  handleWrapJump(lng: number): void;
}

const patchedPrototypes = new WeakSet<object>();

/**
 * The world copy of a tile nearest a centre longitude, as the globe picks it.
 * @param centreLng The map centre's longitude, in degrees.
 * @param tileX The tile's column at zoom `tileZ`.
 */
export function nearestWrap(centreLng: number, tileX: number, tileZ: number): number {
  const centreWorldX = (centreLng + 180) / 360;
  const tileCentreWorldX = (tileX + 0.5) / 2 ** tileZ;
  // Adding 0 turns the -0 Math.round gives for small negatives into 0.
  return Math.round(centreWorldX - tileCentreWorldX) + 0;
}

/** Moves each in-view tile to its world copy nearest `lng`, keyed afresh. */
function rewrapToCentre(manager: TileManagerInternals, lng: number) {
  const tiles: Record<string, { tileID: OverscaledTileID }> = {};
  let hasMoved = false;
  for (const tile of Object.values(manager._inViewTiles._tiles)) {
    const wrap = nearestWrap(lng, tile.tileID.canonical.x, tile.tileID.canonical.z);
    if (wrap !== tile.tileID.wrap) {
      tile.tileID = tile.tileID.unwrapTo(wrap);
      hasMoved = true;
    }
    tiles[tile.tileID.key] = tile;
  }
  manager._inViewTiles._tiles = tiles;
  if (hasMoved) manager._resetTileReloadTimers();
}

/** Whether the manager still has the internals the fix relies on; a MapLibre update may rename them. */
function hasExpectedInternals(manager: TileManagerInternals): boolean {
  return (
    typeof manager.handleWrapJump === 'function' &&
    typeof manager._resetTileReloadTimers === 'function' &&
    typeof manager._inViewTiles?._tiles === 'object' &&
    typeof manager.transform === 'object'
  );
}

/**
 * Replaces handleWrapJump on the TileManager class, once; flat (mercator) rendering keeps MapLibre's own,
 * as does a MapLibre whose internals no longer match (the hexes then blink on polar pans, but nothing breaks).
 */
function patchTileManager(manager: TileManagerInternals) {
  const prototype = Object.getPrototypeOf(manager) as TileManagerInternals;
  if (patchedPrototypes.has(prototype) || !hasExpectedInternals(manager)) return;
  patchedPrototypes.add(prototype);
  const handleWrapJump = prototype.handleWrapJump;
  prototype.handleWrapJump = function (this: TileManagerInternals, lng: number) {
    if (this.transform.isGlobeRendering !== true) return handleWrapJump.call(this, lng);
    this._prevLng = lng;
    rewrapToCentre(this, lng);
  };
}

/**
 * Applies the fix to the map's tile managers once its style has sources.
 * @param map The MapLibre map; the fix patches MapLibre's TileManager class, so it covers every map.
 */
export function keepGlobeTilesOnWrapJumps(map: MlMap): void {
  const patchFromStyle = () => {
    const managers = (map.style as unknown as { tileManagers?: Record<string, TileManagerInternals> }).tileManagers;
    const manager = managers && Object.values(managers)[0];
    if (!manager) return;
    patchTileManager(manager);
    map.off('styledata', patchFromStyle);
  };
  map.on('styledata', patchFromStyle);
}
