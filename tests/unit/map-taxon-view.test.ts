/** Centring a picked taxon's extent on its busiest place. */
import { boundsAround } from '~/lib/map/taxonView';

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
