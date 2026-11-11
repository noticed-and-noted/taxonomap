/**
 * Where the map goes when a species or group is picked in search: out far
 * enough to hold every record, centred on the middle of them.
 */
import { occurrenceTileTemplate, type TileFilter } from '~/lib/gbif';
import { decodeHexes, hexCentre, type Hex, type LngLat } from './occGrid';

/** Hexes across the one world tile the records' middle is found from: cells about 400 km wide at the equator. */
const WORLD_HEX_PER_TILE = 100;

export type Bbox = readonly [west: number, south: number, east: number, north: number];

/**
 * Farthest from the equator the view is centred. The globe draws larger nearer a pole at the same zoom,
 * and MapLibre won't reliably fly below the map's least zoom, so past this a polar range fills the view.
 */
const MAX_CENTRE_LAT = 70;

export interface RecordsView {
  /** Box around every cell with records, clipped to the world. */
  extent: Bbox;
  /** The middle of the cells with records (no nearer a pole than MAX_CENTRE_LAT), or the busiest cell when they ring the globe. */
  centre: LngLat;
}

/** Below this length the records' mean direction is noise: records spread all round the globe have no middle. */
const MIN_MEAN_LENGTH = 0.1;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * The middle of the records on the globe: the mean of their cells' centres as 3D unit vectors, weighted
 * by record count, so a range that crosses the antimeridian or rings a pole is averaged the right way
 * round, and a few stray records (zoo animals abroad) don't drag the view off the rest.
 * @returns The middle, or null when the records spread evenly all round the globe.
 */
export function middleOf(hexes: Hex[]): LngLat | null {
  let [sumX, sumY, sumZ, records] = [0, 0, 0, 0];
  for (const hex of hexes) {
    const [lng, lat] = hexCentre(hex);
    const [lambda, phi] = [toRadians(lng), toRadians(lat)];
    const { total } = hex.properties;
    sumX += total * Math.cos(phi) * Math.cos(lambda);
    sumY += total * Math.cos(phi) * Math.sin(lambda);
    sumZ += total * Math.sin(phi);
    records += total;
  }
  const [meanX, meanY, meanZ] = [sumX / records, sumY / records, sumZ / records];
  if (Math.hypot(meanX, meanY, meanZ) < MIN_MEAN_LENGTH) return null;
  return [toDegrees(Math.atan2(meanY, meanX)), toDegrees(Math.atan2(meanZ, Math.hypot(meanX, meanY)))];
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

/** The last world grid fetched, by URL: an empty map asks again on every pan, but the filter rarely changes. */
let lastWorld: { url: string; hexes: Promise<Hex[] | null> } | undefined;

/**
 * The home cells with records on a coarse world grid of a filter's records.
 * @returns The cells, or null when the tile can't be loaded.
 */
function worldHexes(filter: TileFilter): Promise<Hex[] | null> {
  const url = occurrenceTileTemplate(filter, { hexPerTile: WORLD_HEX_PER_TILE }, 'mvt').replace('{z}/{x}/{y}', '0/0/0');
  if (lastWorld?.url === url) return lastWorld.hexes;
  const hexes = fetchWorldHexes(url);
  lastWorld = { url, hexes };
  const forget = () => {
    if (lastWorld?.hexes === hexes) lastWorld = undefined;
  };
  // A failed load is asked again next time.
  hexes.then((loaded) => loaded ?? forget(), forget);
  return hexes;
}

async function fetchWorldHexes(url: string): Promise<Hex[] | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  // The world tile pads itself with wrapped copies of its own edge cells: count each cell once.
  return (await decodeHexes(await response.arrayBuffer(), { x: 0, y: 0 }, 0)).filter(
    (hex) => hex.properties.home && hex.properties.total > 0,
  );
}

/**
 * Where a filter's records are, from a coarse world grid of them. Unlike GBIF's
 * capabilities extent, this honours every filter the map does (continent, year…).
 * @returns The records' extent and middle, or null when there are none or the tile can't be loaded.
 */
export async function recordsView(filter: TileFilter): Promise<RecordsView | null> {
  const hexes = await worldHexes(filter);
  if (!hexes?.length) return null;
  const busiest = hexes.reduce((best, hex) => (hex.properties.total > best.properties.total ? hex : best));
  const [lng, lat] = middleOf(hexes) ?? hexCentre(busiest);
  const centre: LngLat = [lng, Math.max(-MAX_CENTRE_LAT, Math.min(MAX_CENTRE_LAT, lat))];
  return { extent: extentOf(hexes), centre };
}

const EARTH_RADIUS_KM = 6371;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

export interface NearestRecords {
  /** Box around the nearest cell with records, to fly to. */
  extent: Bbox;
  /** Great-circle distance from the point to that cell's centre. */
  distanceKm: number;
  /** Which way the cell lies from the point. */
  direction: (typeof COMPASS)[number];
}

/** Great-circle distance and initial compass direction from one point to another. */
export function distanceAndDirection(
  [fromLng, fromLat]: LngLat,
  [toLng, toLat]: LngLat,
): Pick<NearestRecords, 'distanceKm' | 'direction'> {
  const [fromPhi, toPhi] = [toRadians(fromLat), toRadians(toLat)];
  const deltaLambda = toRadians(toLng - fromLng);
  const haversine =
    Math.sin((toPhi - fromPhi) / 2) ** 2 + Math.cos(fromPhi) * Math.cos(toPhi) * Math.sin(deltaLambda / 2) ** 2;
  const distanceKm = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
  const bearing = Math.atan2(
    Math.sin(deltaLambda) * Math.cos(toPhi),
    Math.cos(fromPhi) * Math.sin(toPhi) - Math.sin(fromPhi) * Math.cos(toPhi) * Math.cos(deltaLambda),
  );
  const sector = Math.round((toDegrees(bearing) + 360) / 45) % COMPASS.length;
  return { distanceKm, direction: COMPASS[sector]! };
}

/**
 * The cell with records nearest a point, on the same coarse world grid as recordsView
 * (cells about 400 km wide, so the distance is rough).
 * @returns The nearest cell, or null when no record matches the filter anywhere.
 * @throws Error when the world tile can't be loaded.
 */
export async function nearestRecords(filter: TileFilter, point: LngLat): Promise<NearestRecords | null> {
  const hexes = await worldHexes(filter);
  if (!hexes) throw new Error('World grid unavailable');
  let nearest: (Pick<NearestRecords, 'distanceKm' | 'direction'> & { hex: Hex }) | undefined;
  for (const hex of hexes) {
    const candidate = distanceAndDirection(point, hexCentre(hex));
    if (!nearest || candidate.distanceKm < nearest.distanceKm) nearest = { ...candidate, hex };
  }
  if (!nearest) return null;
  return { extent: extentOf([nearest.hex]), distanceKm: nearest.distanceKm, direction: nearest.direction };
}
