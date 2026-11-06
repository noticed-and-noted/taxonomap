/**
 * The tree of life and species pages from the cubes: naming a page's taxon for them, its counts (none
 * for a rank they don't hold), siblings, whole-rank and named totals, and the mini-map's cells.
 */
import { latLngToCell } from 'h3-js';
import type { NameUsage } from '~/lib/gbif';
import { miniMapShapes } from '~/lib/cubes/miniMap';
import { cubeRankOf, cubeTaxonOf, siblingCounts, speciesCounts } from '~/lib/cubes/species';
import { countKey, namedTotals, rankTotals } from '~/lib/cubes/tree';
import { chartRow, cubeSet, mapRow } from './helpers/cubes';

const FOX = {
  key: 5219243,
  rank: 'SPECIES',
  canonicalName: 'Vulpes vulpes',
  scientificName: 'Vulpes vulpes L.',
  kingdom: 'Animalia',
  genus: 'Vulpes',
} as NameUsage;

describe('cubeTaxonOf', () => {
  it('names a page’s taxon at its rank, with its kingdom', () => {
    const classification = [{ name: 'Animalia', rank: 'KINGDOM' as const }];
    expect(cubeTaxonOf({ rank: 'SPECIES', canonicalName: 'Vulpes vulpes', classification })).toEqual({
      rank: 'species',
      taxon: 'Vulpes vulpes',
      kingdom: 'Animalia',
    });
    expect(cubeTaxonOf({ rank: 'KINGDOM', canonicalName: 'Plantae', classification: [] })?.kingdom).toBe('Plantae');
    expect(cubeTaxonOf({ rank: 'GENUS', canonicalName: 'Vulpes', classification: [] })).toEqual({
      rank: 'genus',
      taxon: 'Vulpes',
    });
    expect(
      cubeTaxonOf({ rank: 'SUBSPECIES', canonicalName: 'Vulpes vulpes crucigera', classification }),
    ).toBeUndefined();
    expect(cubeRankOf({ rank: 'VARIETY' })).toBeNull();
  });
});

describe('speciesCounts', () => {
  it('has nothing for a rank the cubes don’t hold, without reading them', async () => {
    const cubes = cubeSet();
    expect(await speciesCounts(cubes, { ...FOX, rank: 'SUBSPECIES' })).toEqual({
      count: 0,
      years: [],
      months: Array(12).fill(0),
    });
    expect(cubes.chartRows).not.toHaveBeenCalled();
  });

  it('counts a kingdom’s own rows whatever their kingdom column, and taxa without a kingdom', async () => {
    const cubes = cubeSet({ chartRows: vi.fn(async () => [chartRow({ kingdom: null, records: 2n })]) });
    expect((await speciesCounts(cubes, { ...FOX, rank: 'KINGDOM' })).count).toBe(2);
    expect((await speciesCounts(cubes, { ...FOX, kingdom: undefined } as unknown as NameUsage)).count).toBe(2);
  });
});

describe('siblingCounts', () => {
  it('lists the genus’s other recorded species, most recorded first', async () => {
    const cubes = cubeSet({
      chartRowsBetween: vi.fn(async () => [
        chartRow({ taxon: 'Vulpes lagopus', records: 1n }),
        chartRow({ taxon: 'Vulpes zerda', records: 5n }),
        chartRow({ taxon: 'Vulpes vulpes', records: 9n }),
      ]),
    });
    const children = [
      { key: 1, canonicalName: 'Vulpes lagopus', scientificName: 'Vulpes lagopus' },
      { key: 2, canonicalName: 'Vulpes zerda', scientificName: 'Vulpes zerda' },
      { key: 3, canonicalName: 'Vulpes corsac', scientificName: 'Vulpes corsac' },
      { key: FOX.key, canonicalName: 'Vulpes vulpes', scientificName: 'Vulpes vulpes' },
    ];
    expect((await siblingCounts(cubes, FOX, children, 8)).map((sibling) => sibling.key)).toEqual([2, 1]);
  });

  it('has none without a genus', async () => {
    expect(await siblingCounts(cubeSet(), { ...FOX, genus: undefined } as unknown as NameUsage, [], 8)).toEqual([]);
  });
});

describe('siblingCounts without a kingdom or canonical names', () => {
  it('matches names without a kingdom, and falls back to scientific names', async () => {
    const cubes = cubeSet({
      chartRowsBetween: vi.fn(async () => [chartRow({ kingdom: null, taxon: 'Vulpes zerda', records: 2n })]),
    });
    const usage = { ...FOX, kingdom: undefined } as unknown as NameUsage;
    const siblings = await siblingCounts(cubes, usage, [{ key: 2, scientificName: 'Vulpes zerda' }], 8);
    expect(siblings).toEqual([{ key: 2, scientificName: 'Vulpes zerda', count: 2 }]);
  });
});

describe('rankTotals and namedTotals', () => {
  it('totals a whole rank, and named taxa one by one, by kingdom and name', async () => {
    const cubes = cubeSet({
      scale: 3,
      chartRowsBetween: vi.fn(async () => [
        chartRow({ taxon: 'Aves', records: 1n }),
        chartRow({ taxon: 'Aves', records: 1n }),
      ]),
      chartRows: vi.fn(async ({ taxon }) => [chartRow({ taxon, kingdom: null, records: 1n })]),
    });
    expect(await rankTotals(cubes, 'class')).toEqual(new Map([[countKey('Animalia', 'Aves'), 6]]));
    expect(await namedTotals(cubes, 'genus', ['Turdus', 'Parus'])).toEqual(
      new Map([
        [countKey(null, 'Turdus'), 3],
        [countKey(null, 'Parus'), 3],
      ]),
    );
  });
});

describe('miniMapShapes', () => {
  it('draws the taxon’s coarsest cells in its kingdom, scaled, inside the canvas', async () => {
    const london = BigInt(`0x${latLngToCell(51.5, -0.1, 2)}`);
    const pacific = BigInt(`0x${latLngToCell(0, 179.9, 2)}`);
    const mapRows = vi.fn(async () => [
      mapRow({ cell: london, records: 2n }),
      mapRow({ cell: london, records: 1n, kingdom: 'Plantae' }),
      mapRow({ cell: pacific, records: 1n }),
    ]);
    const { shapes, level } = await miniMapShapes(
      cubeSet({ scale: 2, mapRows }),
      { rank: 'species', taxon: 'Vulpes vulpes' },
      'Animalia',
      1024,
    );
    expect(mapRows).toHaveBeenCalledWith({ rank: 'species', taxon: 'Vulpes vulpes' }, 2, null);
    expect(shapes.map((shape) => shape.total)).toEqual([4, 2]);
    const [londonX, londonY] = shapes[0]!.points[0]!;
    expect(londonX).toBeGreaterThan(500);
    expect(londonX).toBeLessThan(530);
    expect(londonY).toBeGreaterThan(300);
    expect(londonY).toBeLessThan(360);
    // A cell across the antimeridian is drawn whole, off the right edge, not smeared across the map.
    const pacificXs = shapes[1]!.points.map(([pixelX]) => pixelX);
    expect(Math.max(...pacificXs) - Math.min(...pacificXs)).toBeLessThan(100);
    expect(level).toBe(2);
    const kingdomWide = await miniMapShapes(
      cubeSet({ mapRows }),
      { rank: 'kingdom', taxon: 'Animalia' },
      'Animalia',
      1024,
    );
    expect(kingdomWide.shapes[0]?.total).toBe(3);
  });
});
