/** Centring a picked taxon's extent on its busiest place. */
import type { Hex } from '~/lib/map/occGrid';
import { boundsAround, recordsView } from '~/lib/map/taxonView';

const decodedHexes = vi.hoisted(() => ({ current: [] as Hex[] }));
vi.mock('~/lib/map/occGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/map/occGrid')>()),
  decodeHexes: async () => decodedHexes.current,
}));

/** A square cell (closed ring) centred on a point, half a degree each way. */
function cell([lng, lat]: [number, number], total: number, home = true): Hex {
  const corners: [number, number][] = [
    [lng - 0.5, lat - 0.5],
    [lng + 0.5, lat - 0.5],
    [lng + 0.5, lat + 0.5],
    [lng - 0.5, lat + 0.5],
  ];
  return {
    type: 'Feature',
    properties: { id: `${lng},${lat}`, total, home },
    geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]!]] },
  };
}

describe('recordsView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response(new ArrayBuffer(1)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('spans the home cells with records and centres on the busiest', async () => {
    decodedHexes.current = [
      cell([10, 50], 5),
      cell([-20, 10], 40),
      // A wrapped copy from the tile's padding, and an empty cell: neither counts.
      cell([179, 0], 999, false),
      cell([100, -60], 0),
    ];
    expect(await recordsView({})).toEqual({ extent: [-20.5, 9.5, 10.5, 50.5], busiest: [-20, 10] });
  });

  it('handles more points than a function call takes as arguments', async () => {
    decodedHexes.current = Array.from({ length: 30_000 }, (_unused, index) => cell([(index % 300) - 150, 0], index));
    expect((await recordsView({}))?.extent).toEqual([-150.5, -0.5, 149.5, 0.5]);
  });

  it('is null with no records', async () => {
    decodedHexes.current = [cell([0, 0], 0)];
    expect(await recordsView({})).toBeNull();
  });
});

const toMercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

describe('boundsAround', () => {
  it('keeps the extent and centres on the point', () => {
    const [west, south, east, north] = boundsAround([10, 50], [-10, 40, 20, 60]);
    expect(west).toBeLessThanOrEqual(-10);
    expect(east).toBeGreaterThanOrEqual(20);
    expect(south).toBeLessThanOrEqual(40);
    expect(north).toBeCloseTo(60);
    expect((west + east) / 2).toBeCloseTo(10);
    expect((toMercatorY(south) + toMercatorY(north)) / 2).toBeCloseTo(toMercatorY(50));
  });

  it('never spans more than the world', () => {
    const [west, south, east, north] = boundsAround([170, 80], [-180, -80, 180, 84]);
    expect(east - west).toBeLessThanOrEqual(360);
    expect(south).toBeGreaterThanOrEqual(-85);
    expect(north).toBeLessThanOrEqual(85);
  });
});
