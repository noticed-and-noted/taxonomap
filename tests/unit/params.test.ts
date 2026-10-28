import {
  buildUrl,
  circleToWkt,
  polygonToWkt,
  round,
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

  it('rounds and normalises -0', () => {
    expect(round(51.4449, 2)).toBe(51.44);
    expect(Object.is(round(-0.001, 2), 0)).toBe(true);
  });

  it('snaps radius to the allowed steps', () => {
    expect([0.2, 1.4, 1.6, 3, 4, 7, 8, 20, 40, 400].map(snapRadiusKm)).toEqual([1, 1, 2, 2, 5, 5, 10, 25, 50, 50]);
  });

  it('rounds geolocation to 3 dp', () => {
    expect(roundLatLng(51.507351, -0.127758)).toEqual({ lat: 51.507, lng: -0.128 });
  });

  it('builds a closed circle polygon from rounded inputs', () => {
    const first = circleToWkt(51.50735, -0.12776, 1.8);
    const second = circleToWkt(51.50741, -0.12779, 2.1);
    expect(first).toBe(second); // same rounded centre + same snapped radius → same cache key
    const points = first.slice('POLYGON(('.length, -2).split(',');
    expect(points).toHaveLength(25);
    expect(points[0]).toBe(points[24]);
  });

  it('formats year ranges', () => {
    expect(yearRangeParam([2010, 2000])).toBe('2000,2010');
    expect(yearRangeParam([2020, 2020])).toBe('2020');
    expect(yearRangeParam(null)).toBeUndefined();
  });
});

describe('polygonToWkt', () => {
  it('rounds, closes and winds counter-clockwise', () => {
    const clockwise: [number, number][] = [
      [0, 0],
      [0, 1.000049],
      [1, 1],
      [1, 0],
    ];
    expect(polygonToWkt(clockwise)).toBe('POLYGON((0 0,1 0,1 1,0 1,0 0))');
  });

  it('splits a ring crossing the antimeridian into a multipolygon', () => {
    const hex: [number, number][] = [
      [-178, 0],
      [-179, 1],
      [-181, 1],
      [-182, 0],
      [-181, -1],
      [-179, -1],
    ];
    expect(polygonToWkt(hex)).toBe(
      'MULTIPOLYGON(((-178 0,-179 1,-180 1,-180 -1,-179 -1,-178 0)),((180 1,179 1,178 0,179 -1,180 -1,180 1)))',
    );
  });

  it('splits a ring running past +180 the same way', () => {
    const hex: [number, number][] = [
      [181, 0],
      [180, 1],
      [178, 1],
      [177, 0],
      [178, -1],
      [180, -1],
    ];
    expect(polygonToWkt(hex)).toBe(
      'MULTIPOLYGON(((180 -1,180 1,178 1,177 0,178 -1,180 -1)),((-179 0,-180 1,-180 -1,-179 0)))',
    );
  });

  it('moves a ring on a wrapped world copy back onto -180..180', () => {
    const square: [number, number][] = [
      [361, 0],
      [362, 0],
      [362, 1],
      [361, 1],
    ];
    expect(polygonToWkt(square)).toBe('POLYGON((1 0,2 0,2 1,1 1,1 0))');
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
