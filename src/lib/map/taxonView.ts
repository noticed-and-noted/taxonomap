/**
 * Where the map goes when a species or group is picked in search: out far
 * enough to hold every record, centred on the place with the most of them.
 */
import { occurrenceTileTemplate, type TileFilter } from '~/lib/gbif';
import { decodeHexes, hexCentre, type Hex, type LngLat } from './occGrid';

/** Hexes across the one world tile the busiest place is picked from: cells about 400 km wide at the equator. */
const WORLD_HEX_PER_TILE = 100;
/** Latitude limit of a centred box: Mercator, and so fitting, runs out near the poles. */
const MAX_LAT = 85;

export type Bbox = readonly [west: number, south: number, east: number, north: number];

export interface RecordsView {
  /** Box around every cell with records, clipped to the world. */
  extent: Bbox;
  /** Centre of the cell with the most records. */
  busiest: LngLat;
}

/**
 * Bounding box of the cells' outlines, clipped to the world's longitudes.
 * A loop, not Math.min(...points): a busy group has more points than Safari allows as arguments.
 */
function extentOf(hexes: Hex[]): Bbox {
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const hex of hexes) {
    for (const [lng = 0, lat = 0] of hex.geometry.coordinates[0]!) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return [Math.max(-180, west), south, Math.min(180, east), north];
}

/**
 * Where a filter's records are, from a coarse world grid of them. Unlike GBIF's
 * capabilities extent, this honours every filter the map does (continent, year…).
 * @returns The records' extent and busiest place, or null when there are none or the tile can't be loaded.
 */
export async function recordsView(filter: TileFilter): Promise<RecordsView | null> {
  const url = occurrenceTileTemplate(filter, { hexPerTile: WORLD_HEX_PER_TILE }, 'mvt').replace('{z}/{x}/{y}', '0/0/0');
  const response = await fetch(url);
  if (!response.ok) return null;
  // The world tile pads itself with wrapped copies of its own edge cells: count each cell once.
  const hexes = (await decodeHexes(await response.arrayBuffer(), { x: 0, y: 0 }, 0)).filter(
    (hex) => hex.properties.home && hex.properties.total > 0,
  );
  if (!hexes.length) return null;
  const busiest = hexes.reduce((best, hex) => (hex.properties.total > best.properties.total ? hex : best));
  return { extent: extentOf(hexes), busiest: hexCentre(busiest) };
}

const toMercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const fromMercatorY = (mercatorY: number) => (Math.atan(Math.exp(mercatorY)) * 360) / Math.PI - 90;

/**
 * The smallest box centred on a point that still holds the whole extent.
 * Latitudes mirror in Mercator, so the point is also the centre of the fitted view.
 * @param centre The [lng, lat] the box is centred on.
 * @param extent The box it must hold.
 */
export function boundsAround([lng, lat]: LngLat, [west, south, east, north]: Bbox): Bbox {
  const halfWidth = Math.min(180, Math.max(lng - west, east - lng));
  const centreY = toMercatorY(lat);
  const halfHeight = Math.max(centreY - toMercatorY(south), toMercatorY(north) - centreY);
  return [
    lng - halfWidth,
    Math.max(-MAX_LAT, fromMercatorY(centreY - halfHeight)),
    lng + halfWidth,
    Math.min(MAX_LAT, fromMercatorY(centreY + halfHeight)),
  ];
}
