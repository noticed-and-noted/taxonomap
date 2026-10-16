/**
 * Keeping vector tiles off the poles on the globe.
 *
 * MapLibre's globe fills the polar caps by stretching every fill edge that
 * lies on the north edge of a top-row tile (or the south edge of a bottom-row
 * one) out to the pole. GBIF hexes and basemap land are clipped at the tile
 * edge, so each one along it became a spike or wedge to the pole. Vector
 * sources go through a protocol that trims polygons in those rows a unit
 * inside the edge: nothing lies on it, so nothing is stretched, and the caps
 * stay empty. Other tiles pass through untouched.
 */
import Point from '@mapbox/point-geometry';
import type { VectorTileFeatureLike, VectorTileLayerLike, VectorTileLike } from '@maplibre/vt-pbf';

const PREFIX = 'polar+';
/** URL schemes routed through {@link loadPolarTile} (MapLibre keys protocols by everything before `://`). */
export const POLAR_SCHEMES = [`${PREFIX}https`, `${PREFIX}http`];

/** Route a tile URL template, or a TileJSON URL, through the polar trim. */
export const viaPolar = (template: string) => PREFIX + template;

type XY = { x: number; y: number };

/** Clip a ring to minY <= y <= maxY (Sutherland–Hodgman, one half-plane at a time). */
export function clipRingY<T extends XY>(ring: T[], minY: number, maxY: number, make: (x: number, y: number) => T): T[] {
  const open =
    ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring;
  const half = (pts: T[], inside: (p: T) => boolean, edgeY: number) => {
    const out: T[] = [];
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      if (inside(cur) !== inside(prev)) {
        const t = (edgeY - prev.y) / (cur.y - prev.y);
        out.push(make(prev.x + t * (cur.x - prev.x), edgeY));
      }
      if (inside(cur)) out.push(cur);
    });
    return out;
  };
  const clipped = half(
    half(open, (p) => p.y >= minY, minY),
    (p) => p.y <= maxY,
    maxY,
  );
  return clipped.length >= 3 ? [...clipped, clipped[0]!] : [];
}

/** The tile's row from a tile URL, and whether it borders a pole. */
export function polarRow(url: string): { north: boolean; south: boolean } {
  const m = /\/(\d+)\/\d+\/(\d+)\.(?:mvt|pbf)\b/.exec(url);
  if (!m) return { north: false, south: false };
  const z = Number(m[1]);
  const y = Number(m[2]);
  return { north: y === 0, south: y === 2 ** z - 1 };
}

/** Re-encode a vector tile with its polygons trimmed off the polar edge(s). */
export async function trimPolar(data: ArrayBuffer, north: boolean, south: boolean): Promise<Uint8Array> {
  const [{ VectorTile }, { PbfReader }, { fromVectorTileJs }] = await Promise.all([
    import('@mapbox/vector-tile'),
    import('pbf'),
    import('@maplibre/vt-pbf'),
  ]);
  const tile = new VectorTile(new PbfReader(data));
  const out: VectorTileLike = { layers: {} };
  for (const [name, layer] of Object.entries(tile.layers)) {
    const minY = north ? 1 : -Infinity;
    const maxY = south ? layer.extent - 1 : Infinity;
    const features: VectorTileFeatureLike[] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      let geometry = f.loadGeometry();
      if (f.type === 3) {
        geometry = geometry.map((r) => clipRingY(r, minY, maxY, (x, y) => new Point(x, y))).filter((r) => r.length);
        if (!geometry.length) continue;
      }
      features.push({
        type: f.type,
        properties: f.properties,
        id: f.id,
        extent: f.extent,
        loadGeometry: () => geometry,
      });
    }
    const trimmed: VectorTileLayerLike = {
      version: layer.version,
      name,
      extent: layer.extent,
      length: features.length,
      feature: (i) => features[i]!,
    };
    out.layers[name] = trimmed;
  }
  return fromVectorTileJs(out);
}

/** A failed fetch, shaped like MapLibre's own (`status`, `url`) for the map's error handling. */
class TileError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly url: string,
  ) {
    super(`Tile request failed${status ? ` (${status})` : ''}: ${url}`);
  }
}

/**
 * MapLibre protocol loader (register with addProtocol for {@link POLAR_SCHEMES}).
 * A TileJSON comes back with its tile URLs routed here too.
 */
export async function loadPolarTile(
  params: { url: string; type?: string },
  abort: AbortController,
): Promise<{ data: ArrayBuffer | Uint8Array | object }> {
  const url = params.url.slice(PREFIX.length);
  let res: Response;
  try {
    res = await fetch(url, { signal: abort.signal });
  } catch (e) {
    if (abort.signal.aborted) throw e;
    throw new TileError(undefined, url);
  }
  if (!res.ok) throw new TileError(res.status, url);
  if (params.type === 'json') {
    const json = (await res.json()) as { tiles?: string[] };
    return { data: { ...json, tiles: json.tiles?.map(viaPolar) } };
  }
  const data = await res.arrayBuffer();
  const { north, south } = polarRow(url);
  return { data: data.byteLength && (north || south) ? await trimPolar(data, north, south) : data };
}
