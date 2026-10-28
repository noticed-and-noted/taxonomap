/**
 * Web Worker that decodes GBIF density tiles to hexes (see hexDecoder.ts),
 * so a burst of arriving tiles doesn't stall the map's frames.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { hexesOf, type Hex, type TileId } from './occGrid';

/** A tile to decode, tagged so its answer finds its caller. */
export interface DecodeRequest {
  id: number;
  data: ArrayBuffer;
  tile: TileId;
  level: number;
}

/** The decoded hexes, or none if the tile would not decode. */
export interface DecodeResponse {
  id: number;
  hexes?: Hex[];
}

/**
 * Decodes one request's tile.
 * @param request The tile bytes and where they belong.
 * @returns Its hexes, or no hexes when the bytes are not a tile.
 */
export function decodeRequest({ id, data, tile, level }: DecodeRequest): DecodeResponse {
  if (!data.byteLength) return { id, hexes: [] };
  try {
    return { id, hexes: hexesOf(new VectorTile(new PbfReader(data)), tile, level) };
  } catch {
    // The caller treats a missing answer as a failed tile and asks again next plan.
    return { id };
  }
}

self.addEventListener('message', (event: MessageEvent<DecodeRequest>) => {
  self.postMessage(decodeRequest(event.data));
});
