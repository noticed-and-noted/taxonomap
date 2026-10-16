/**
 * Counts tiles in the current load burst so the map can show "12 / 18 tiles".
 *
 * MapLibre fires `dataloading` when a tile starts and `data`, `dataabort` or
 * `error` when it settles, but a 404 settles silently. So instead of trusting
 * a settle event per tile, every event re-checks the pending tiles' state.
 * A burst ends (and the counts reset) when the map goes idle.
 */

/** The parts of a MapLibre Tile this needs. */
export interface TileLike {
  state: string;
  aborted?: boolean;
}

const SETTLED = new Set(['loaded', 'errored', 'unloaded']);

export interface TileProgress {
  done: number;
  total: number;
}

export function createTileProgress() {
  const pending = new Set<TileLike>();
  let total = 0;

  const sweep = () => {
    for (const t of pending) if (t.aborted || SETTLED.has(t.state)) pending.delete(t);
  };

  return {
    /** A tile started loading. */
    start(tile: TileLike) {
      if (pending.has(tile)) return;
      pending.add(tile);
      total++;
    },
    /** A tile settled (or something else happened): drop every tile that has. */
    settle(tile?: TileLike) {
      if (tile) pending.delete(tile);
      sweep();
    },
    /** The map is idle: the burst is over. */
    reset() {
      pending.clear();
      total = 0;
    },
    get(): TileProgress {
      return { done: total - pending.size, total };
    },
  };
}
