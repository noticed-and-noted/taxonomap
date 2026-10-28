/**
 * Decodes GBIF density tiles on a Web Worker (hexWorker.ts), falling back to
 * the main thread where workers are unavailable (tests, old browsers) or the
 * worker fails to load.
 */
import { decodeHexes, type Hex, type TileId } from './occGrid';
import type { DecodeResponse } from './hexWorker';

interface Pending {
  resolve: (hexes: Hex[]) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let isBroken = false;
let nextId = 0;
const pending = new Map<number, Pending>();

function onAnswer({ data }: MessageEvent<DecodeResponse>) {
  const waiting = pending.get(data.id);
  pending.delete(data.id);
  if (data.hexes) waiting?.resolve(data.hexes);
  else waiting?.reject(new Error('Tile did not decode'));
}

/** The worker failed to load or crashed: fail what it held and decode on the main thread from now on. */
function onBroken() {
  isBroken = true;
  worker?.terminate();
  worker = undefined;
  for (const waiting of pending.values()) waiting.reject(new Error('Tile decoder failed'));
  pending.clear();
}

function decoder(): Worker | undefined {
  if (worker || isBroken || typeof Worker === 'undefined') return worker;
  worker = new Worker(new URL('./hexWorker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', onAnswer);
  worker.addEventListener('error', onBroken);
  return worker;
}

/**
 * Decode a GBIF density tile (MVT bytes) to hexes, off the main thread when it can.
 * @param data The tile's bytes; handed to the worker, so unusable afterwards.
 * @param tile The tile's position.
 * @param level Its grid level.
 * @returns The tile's hexes.
 * @throws When the bytes do not decode as a tile.
 */
export function decodeOffThread(data: ArrayBuffer, tile: TileId, level: number): Promise<Hex[]> {
  const target = decoder();
  if (!target) return decodeHexes(data, tile, level);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, data, tile, level }, [data]);
  });
}
