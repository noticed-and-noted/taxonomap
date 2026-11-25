/**
 * Messages between islands, not in the URL: state one island publishes for others (mostly
 * MapCanvas, which no other island imports) and one-shot requests to the map.
 */
import { atom } from 'nanostores';
import type { RecordPlace } from '~/lib/map/recordPlace';
import type { ScreenBox } from '~/lib/tour';
import type { FilterGroupId } from './filters';

export interface HexGeometry {
  /** Outer ring, lng/lat. */
  ring: [number, number][];
  /** CCW WKT for GBIF geometry filters. */
  wkt: string;
  /** Count shown on the tile (before live refinement). */
  tileTotal: number;
}

/** Geometry of the selected hex, published by MapCanvas. */
export const $hexGeometry = atom<HexGeometry | null>(null);

/** Where the record expanded in the records list sits (lib/map/recordPlace.ts), published by HexRecords for the map. */
export const $recordPlace = atom<RecordPlace | null>(null);

export type FlyRequest =
  | {
      kind: 'bounds';
      bbox: readonly [number, number, number, number];
      maxZoom?: number;
      /** Fly here at the zoom that fits `bbox`, rather than to the box's own centre. */
      centre?: readonly [number, number];
    }
  | { kind: 'point'; lng: number; lat: number; zoom: number };

/** What a click on the map does: select a hex (explorer) or drop a pin (near me). */
export const $mapMode = atom<'explore' | 'pin'>('explore');

/** Current map bounds [west, south, east, north], published by MapCanvas. */
export const $mapBounds = atom<readonly [number, number, number, number] | null>(null);

/** The hex grid level on the map (lib/map/occGrid.ts): set by zooming, never by panning. The colour bins follow it. */
export const $gridLevel = atom(0);

/** Hex tile loading for the current burst, published by the map (`total` 0: nothing counted yet). */
export const $mapLoad = atom<{ loading: boolean; done: number; total: number }>({ loading: true, done: 0, total: 0 });

/** GBIF's density tiles failed to load, published by MapCanvas and shown as a note by MapProgress. */
export const $tilesFailed = atom(false);

/**
 * The map's latest check, once loaded and settled, of whether any cell is in view (published by MapCanvas).
 * A new object every check, so listeners hear each one even when the answer is unchanged.
 */
export const $viewCheck = atom<{ isEmpty: boolean }>({ isEmpty: false });

/** Set by the map when the browser has no WebGL2, so the map can't draw at all. */
export const $mapUnsupported = atom(false);

/** The desktop filter rail's open flyout: a filter group or settings (phones use the Filters sheet instead). */
export const $railOpen = atom<FilterGroupId | 'settings' | null>(null);

/** One-shot camera requests (place search, taxon extent). */
export const $flyTo = atom<FlyRequest | null>(null);

/**
 * Tour and hint hook: MapCanvas finds the busiest hex in view and answers on
 * $busiestHexBox before this returns. 'select' also selects it (its panel
 * stays closed); 'locate' only points at it.
 */
export const $busiestHexRequest = atom<'select' | 'locate' | null>(null);

/** Where the hex picked for $busiestHexRequest sits on screen; null when no cell was loaded. */
export const $busiestHexBox = atom<ScreenBox | null>(null);
