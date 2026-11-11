/** Centring a picked taxon's extent on the middle of its records. */
import type { Hex } from '~/lib/map/occGrid';
import { distanceAndDirection, middleOf, nearestRecords, recordsView } from '~/lib/map/taxonView';

const decodedHexes = vi.hoisted(() => ({ current: [] as Hex[] }));
vi.mock('~/lib/map/occGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/map/occGrid')>()),
  decodeHexes: async () => decodedHexes.current,
}));

/** A filter no earlier test used: the world grid is kept per filter. */
let lastTaxonKey = 0;
const freshFilter = () => ({ taxonKey: ++lastTaxonKey });

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

  it('spans the home cells with records and centres on the middle of the records', async () => {
    decodedHexes.current = [
      cell([10, 0], 30),
      cell([-20, 0], 15),
      // A wrapped copy from the tile's padding, and an empty cell: neither counts.
      cell([179, 0], 999, false),
      cell([100, -60], 0),
    ];
    const view = await recordsView(freshFilter());
    expect(view?.extent).toEqual([-20.5, -0.5, 10.5, 0.5]);
    expect(view?.centre[0]).toBeCloseTo(0, 0);
    expect(view?.centre[1]).toBeCloseTo(0);
  });

  it('handles more points than a function call takes as arguments', async () => {
    decodedHexes.current = Array.from({ length: 30_000 }, (_unused, index) => cell([(index % 300) - 150, 0], index));
    expect((await recordsView(freshFilter()))?.extent).toEqual([-150.5, -0.5, 149.5, 0.5]);
  });

  it('centres no nearer a pole than the globe can fly to', async () => {
    decodedHexes.current = [-180, -90, 0, 90].map((lng) => cell([lng, -60], 1));
    expect((await recordsView(freshFilter()))?.centre[1]).toBe(-70);
  });

  it('falls back to the busiest cell when the records ring the globe', async () => {
    decodedHexes.current = [cell([0, 0], 5), cell([90, 0], 6), cell([180, 0], 5), cell([-90, 0], 6)];
    expect((await recordsView(freshFilter()))?.centre).toEqual([90, 0]);
  });

  it('is null with no records', async () => {
    decodedHexes.current = [cell([0, 0], 0)];
    expect(await recordsView(freshFilter())).toBeNull();
  });
});

describe('middleOf', () => {
  it('leans towards the cells with more records', () => {
    const [lng = 0] = middleOf([cell([0, 0], 3), cell([40, 0], 1)]) ?? [];
    expect(lng).toBeGreaterThan(5);
    expect(lng).toBeLessThan(15);
  });

  it('centres a ring of records round the south pole on the pole', () => {
    const ring = [-180, -90, 0, 90].map((lng) => cell([lng, -60], 1));
    expect(middleOf(ring)?.[1]).toBeCloseTo(-90);
  });

  it('averages across the antimeridian the short way round', () => {
    const [lng = 0, lat = 0] = middleOf([cell([170, 0], 1), cell([-170, 0], 1)]) ?? [];
    expect(Math.abs(lng)).toBeCloseTo(180);
    expect(lat).toBeCloseTo(0);
  });
});

describe('nearestRecords', () => {
  const fetchSpy = vi.fn(async () => new Response(new ArrayBuffer(1)));

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picks the closest cell with records and boxes it', async () => {
    decodedHexes.current = [cell([30, 0], 500), cell([3, 4], 1), cell([-2, 0], 0)];
    const nearest = await nearestRecords(freshFilter(), [0, 0]);
    expect(nearest?.extent).toEqual([2.5, 3.5, 3.5, 4.5]);
    expect(nearest?.direction).toBe('north-east');
    expect(nearest?.distanceKm).toBeCloseTo(556, -1);
  });

  it('keeps the closest cell when farther ones come after it', async () => {
    decodedHexes.current = [cell([3, 4], 1), cell([30, 0], 500)];
    expect((await nearestRecords(freshFilter(), [0, 0]))?.extent).toEqual([2.5, 3.5, 3.5, 4.5]);
  });

  it('is null when nothing matches anywhere', async () => {
    decodedHexes.current = [cell([0, 0], 0)];
    expect(await nearestRecords(freshFilter(), [0, 0])).toBeNull();
  });

  it('loads the world grid once per filter', async () => {
    decodedHexes.current = [cell([3, 4], 1)];
    const filter = freshFilter();
    await nearestRecords(filter, [0, 0]);
    await nearestRecords(filter, [50, 50]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer filter’s grid when an older one fails late', async () => {
    let failOlder: (response: Response) => void = () => {};
    fetchSpy.mockReturnValueOnce(new Promise((resolve) => (failOlder = resolve)));
    decodedHexes.current = [cell([3, 4], 1)];
    const older = nearestRecords(freshFilter(), [0, 0]);
    const newer = freshFilter();
    await nearestRecords(newer, [0, 0]);
    failOlder(new Response(null, { status: 503 }));
    await expect(older).rejects.toThrow();
    await nearestRecords(newer, [0, 0]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when the grid cannot load, and asks again next time', async () => {
    const filter = freshFilter();
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(nearestRecords(filter, [0, 0])).rejects.toThrow();
    decodedHexes.current = [cell([3, 4], 1)];
    expect(await nearestRecords(filter, [0, 0])).not.toBeNull();
  });
});

describe('distanceAndDirection', () => {
  it('measures London to Paris', () => {
    const { distanceKm, direction } = distanceAndDirection([-0.1276, 51.5072], [2.3522, 48.8566]);
    expect(distanceKm).toBeCloseTo(344, -1);
    expect(direction).toBe('south-east');
  });

  it('goes the short way across the antimeridian', () => {
    expect(distanceAndDirection([179, 0], [-179, 0])).toEqual({
      distanceKm: expect.closeTo(222, -1),
      direction: 'east',
    });
  });
});
