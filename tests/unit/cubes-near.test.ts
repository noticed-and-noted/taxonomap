/** Near me's circle in the cubes: the resolution-5 cells inside it (the pin's at least), under its month. */
import { cellToLatLng, greatCircleDistance, latLngToCell } from 'h3-js';
import { circleCells, nearArea, NEAR_RESOLUTION } from '~/lib/cubes/near';
import { cubeSet } from './helpers/cubes';

const PIN = { lat: 51.5, lng: -0.1 };
const pinCell = BigInt(`0x${latLngToCell(PIN.lat, PIN.lng, NEAR_RESOLUTION)}`);
const lookup = vi.fn(async (key: number) => (key === 212 ? { scientificName: 'Aves', rank: 'CLASS' } : null));

describe('circleCells', () => {
  it('is the pin’s cell alone for a circle smaller than a cell', async () => {
    expect(await circleCells({ ...PIN, radiusKm: 1 })).toEqual([pinCell]);
  });

  it('keeps the cells whose centre is inside a bigger circle', async () => {
    const cells = await circleCells({ ...PIN, radiusKm: 50 });
    expect(cells.length).toBeGreaterThan(20);
    expect(cells).toContain(pinCell);
    for (const cell of cells.filter((inside) => inside !== pinCell)) {
      const centre = cellToLatLng(cell.toString(16));
      expect(greatCircleDistance(centre, [PIN.lat, PIN.lng], 'km')).toBeLessThanOrEqual(50);
    }
  });
});

describe('nearArea', () => {
  const cubes = cubeSet();

  it('is the circle’s cells under the map’s filters, limited to its month', async () => {
    const area = await nearArea({ ...PIN, radiusKm: 1, month: 6 }, { taxonKey: 212, months: [1] }, cubes, lookup);
    expect(area).toMatchObject({ cubes, cells: [pinCell], resolution: NEAR_RESOLUTION });
    expect(area?.query).toMatchObject({ taxa: [{ rank: 'class', taxon: 'Aves' }], months: [6] });
    const withoutMonth = await nearArea({ ...PIN, radiusKm: 1 }, { months: [1] }, cubes, lookup);
    expect(withoutMonth?.query.months).toEqual([1]);
  });

  it('is null for a taxon the cubes don’t hold', async () => {
    expect(await nearArea({ ...PIN, radiusKm: 1 }, { taxonKey: 7 }, cubes, lookup)).toBeNull();
  });
});
