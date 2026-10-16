/** Trimming polygons off the polar edge of vector tiles, so the globe does not stretch them to the pole. */
import Point from '@mapbox/point-geometry';
import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs } from '@maplibre/vt-pbf';
import { PbfReader } from 'pbf';
import { clipRingY, loadPolarTile, polarRow, trimPolar, viaPolar } from '~/lib/map/polarTiles';

const pt = (x: number, y: number) => ({ x, y });

/** A one-layer tile with a hex straddling the north edge and a line along it. */
function tile(): ArrayBuffer {
  const hex = [pt(100, -50), pt(200, -50), pt(250, 50), pt(200, 150), pt(100, 150), pt(50, 50), pt(100, -50)];
  const features = [
    {
      type: 3 as const,
      properties: { total: 7 },
      id: 1,
      extent: 4096,
      loadGeometry: () => [hex.map((p) => new Point(p.x, p.y))],
    },
    {
      type: 2 as const,
      properties: {},
      id: 2,
      extent: 4096,
      loadGeometry: () => [[new Point(0, 0), new Point(4096, 0)]],
    },
  ];
  const bytes = fromVectorTileJs({
    layers: { occurrence: { version: 2, name: 'occurrence', extent: 4096, length: 2, feature: (i) => features[i]! } },
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('clipRingY', () => {
  it('cuts a ring at the band edges and keeps it closed', () => {
    const square = [pt(0, -10), pt(10, -10), pt(10, 10), pt(0, 10), pt(0, -10)];
    const ring = clipRingY(square, 1, Infinity, pt);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(new Set(ring.map((p) => `${p.x},${p.y}`))).toEqual(new Set(['0,1', '10,1', '10,10', '0,10']));
    expect(clipRingY(square, -Infinity, 5, pt).every((p) => p.y <= 5)).toBe(true);
  });

  it('drops a ring wholly outside the band', () => {
    expect(clipRingY([pt(0, -9), pt(5, -9), pt(5, -2), pt(0, -9)], 1, Infinity, pt)).toEqual([]);
  });
});

describe('polarRow', () => {
  it('finds the top and bottom rows from the tile URL', () => {
    expect(polarRow('https://t.test/v2/map/occurrence/density/2/1/0.mvt?bin=hex')).toEqual({
      north: true,
      south: false,
    });
    expect(polarRow('https://t.test/planet/2/1/3.pbf')).toEqual({ north: false, south: true });
    expect(polarRow('https://t.test/0/0/0.mvt')).toEqual({ north: true, south: true });
    expect(polarRow('https://t.test/2/1/2.mvt')).toEqual({ north: false, south: false });
    expect(polarRow('https://t.test/planet')).toEqual({ north: false, south: false });
  });
});

describe('trimPolar', () => {
  it('moves polygons off the edge and leaves other features alone', async () => {
    const out = new VectorTile(new PbfReader(await trimPolar(tile(), true, false)));
    const layer = out.layers['occurrence']!;
    expect(layer.length).toBe(2);
    const hex = layer.feature(0);
    expect(hex.properties).toEqual({ total: 7 });
    expect(Math.min(...hex.loadGeometry()[0]!.map((p) => p.y))).toBe(1);
    expect(
      layer
        .feature(1)
        .loadGeometry()[0]!
        .map((p) => p.y),
    ).toEqual([0, 0]);
  });
});

describe('loadPolarTile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trims polar-row tiles and passes others through', async () => {
    const data = tile();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(data)),
    );
    const ac = new AbortController();
    const mid = await loadPolarTile({ url: viaPolar('https://t.test/2/1/2.mvt') }, ac);
    expect(new Uint8Array(mid.data as ArrayBuffer)).toEqual(new Uint8Array(data));
    const top = (await loadPolarTile({ url: viaPolar('https://t.test/2/1/0.mvt') }, ac)).data as Uint8Array;
    const hex = new VectorTile(new PbfReader(top)).layers['occurrence']!.feature(0);
    expect(Math.min(...hex.loadGeometry()[0]!.map((p) => p.y))).toBe(1);
    expect(fetch).toHaveBeenCalledWith('https://t.test/2/1/0.mvt', expect.anything());
  });

  it('routes a TileJSON’s tiles through the trim too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ tiles: ['https://t.test/{z}/{x}/{y}.pbf'], maxzoom: 14 })),
    );
    const res = await loadPolarTile({ url: viaPolar('https://t.test/planet'), type: 'json' }, new AbortController());
    expect(res.data).toEqual({ tiles: ['polar+https://t.test/{z}/{x}/{y}.pbf'], maxzoom: 14 });
  });

  it('reports failures with the status and real URL, for the edge-cache fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(
      loadPolarTile({ url: viaPolar('https://t.test/2/1/2.mvt') }, new AbortController()),
    ).rejects.toMatchObject({
      status: 503,
      url: 'https://t.test/2/1/2.mvt',
    });
  });
});
