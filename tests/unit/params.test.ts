import {
  bboxToWkt,
  buildUrl,
  circleToWkt,
  polygonToWkt,
  round,
  roundBbox,
  roundLatLng,
  snapRadiusKm,
  toQueryString,
  yearRangeParam,
} from '~/lib/gbif/params';

describe('params', () => {
  it('sorts keys, drops empties, de-dupes and sorts repeated values', () => {
    expect(toQueryString({ z: 1, a: 'x', facet: ['year', 'month', 'year'], empty: '', n: null, u: undefined })).toBe(
      'a=x&facet=month&facet=year&z=1',
    );
  });

  it('produces identical URLs regardless of key order', () => {
    expect(buildUrl('B', '/p', { b: 2, a: 1 })).toBe(buildUrl('B', '/p', { a: 1, b: 2 }));
    expect(buildUrl('B', '/p', {})).toBe('B/p');
  });

  it('rounds bbox to 2 dp and normalises -0', () => {
    expect(roundBbox([-0.001, 51.4449, 0.12345, 51.678])).toEqual([0, 51.44, 0.12, 51.68]);
    expect(Object.is(round(-0.001, 2), 0)).toBe(true);
  });

  it('snaps radius to the allowed steps', () => {
    expect([0.2, 1.4, 1.6, 3, 4, 7, 8, 20, 40, 400].map(snapRadiusKm)).toEqual([1, 1, 2, 2, 5, 5, 10, 25, 50, 50]);
  });

  it('rounds geolocation to 3 dp', () => {
    expect(roundLatLng(51.507351, -0.127758)).toEqual({ lat: 51.507, lng: -0.128 });
  });

  it('builds a closed counter-clockwise bbox polygon', () => {
    expect(bboxToWkt([-0.2, 51.4, 0, 51.6])).toBe('POLYGON((-0.2 51.4,0 51.4,0 51.6,-0.2 51.6,-0.2 51.4))');
  });

  it('builds a closed circle polygon from rounded inputs', () => {
    const a = circleToWkt(51.50735, -0.12776, 1.8);
    const b = circleToWkt(51.50741, -0.12779, 2.1);
    expect(a).toBe(b); // same rounded centre + same snapped radius → same cache key
    const pts = a.slice('POLYGON(('.length, -2).split(',');
    expect(pts).toHaveLength(25);
    expect(pts[0]).toBe(pts[24]);
  });

  it('formats year ranges', () => {
    expect(yearRangeParam([2010, 2000])).toBe('2000,2010');
    expect(yearRangeParam([2020, 2020])).toBe('2020');
    expect(yearRangeParam(null)).toBeUndefined();
  });
});

describe('polygonToWkt', () => {
  it('rounds, closes and winds counter-clockwise', () => {
    const cw: [number, number][] = [
      [0, 0],
      [0, 1.000049],
      [1, 1],
      [1, 0],
    ];
    expect(polygonToWkt(cw)).toBe('POLYGON((0 0,1 0,1 1,0 1,0 0))');
  });
});

describe('ramp', () => {
  it('scales thresholds by zoom and keeps them increasing', async () => {
    const { thresholdsAt, nice, binLabels } = await import('~/lib/ramp');
    expect(thresholdsAt(6)).toEqual([10, 100, 1_000, 10_000, 100_000, 1_000_000]);
    expect(thresholdsAt(5)).toEqual([50, 500, 5_000, 50_000, 500_000, 5_000_000]);
    expect(thresholdsAt(12)).toEqual([1, 10, 100, 1_000, 10_000, 100_000]);
    expect(nice(37)).toBe(50);
    expect(binLabels(6)).toEqual(['1', '10', '100', '1K', '10K', '100K', '1M']);
  });
});
