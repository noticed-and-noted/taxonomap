/** "What's near me" data: the area filter, recent sightings and the share-card tallies. */
import type { NameRow } from '~/lib/data/types';
import { facets, snapshots, stubNetwork } from './helpers/network';

const NAMES: NameRow[] = [
  [1, 'S', 'Erithacus rubecula', 'European robin', 10],
  [2, 'S', 'Passer domesticus', null, 9],
];
const AREA = { lat: 51.5, lng: -0.12, radiusKm: 2 };

const photoRecord = (key: number, eventDate: string | undefined, speciesKey: number, datasetKey = 'ds1') => ({
  key,
  datasetKey,
  speciesKey,
  ...(eventDate && { eventDate }),
  license: 'http://creativecommons.org/licenses/by/4.0/legalcode',
  media: [{ type: 'StillImage', identifier: `https://img.test/${key}.jpg` }],
});

async function load() {
  vi.resetModules();
  return import('~/lib/near/data');
}

afterEach(() => vi.unstubAllGlobals());

describe('near data', () => {
  it('counts the classes in a circle, optionally for one month', async () => {
    const calls = stubNetwork((url) =>
      url.pathname === '/v1/occurrence/search'
        ? facets(120, 'CLASS_KEY', [[212, 100]])
        : snapshots({ tree: [{ k: 212, n: 'Aves', r: 'C', o: 1, s: 1 }] })(url),
    );
    const { classesNear } = await load();
    await expect(classesNear({ ...AREA, month: 5 })).resolves.toEqual({
      records: 120,
      classes: [{ key: 212, name: 'Aves', records: 100 }],
    });
    const q = calls[0]!.searchParams;
    expect(q.get('geometry')).toMatch(/^POLYGON\(\(/);
    expect(q.get('month')).toBe('5');
    expect(q.get('facetLimit')).toBe('20');
  });

  it('lists recent photographed sightings newest first, with names and dataset titles', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') {
        return {
          count: 3,
          results: [
            photoRecord(10, '2026-03-01', 1),
            photoRecord(11, '2026-06-01T10:00', 2, 'ds2'),
            photoRecord(12, undefined, 1),
            { key: 13, datasetKey: 'ds1', eventDate: '2026-07-01' },
          ],
        };
      }
      if (url.pathname === '/v1/dataset/ds1') return { key: 'ds1', title: 'Garden survey' };
      if (url.pathname === '/v1/dataset/ds2') return undefined;
      return snapshots({ names: NAMES })(url);
    });
    const { recentSightings } = await load();
    const rows = await recentSightings(AREA);
    expect(rows.map((r) => [r.occurrence.key, r.date, r.commonName, r.datasetTitle])).toEqual([
      [11, '2026-06-01', undefined, undefined],
      [10, '2026-03-01', 'European robin', 'Garden survey'],
    ]);
    const q = calls[0]!.searchParams;
    expect(q.get('mediaType')).toBe('StillImage');
    expect(q.get('eventDate')).toMatch(/^\d{4}-\d\d-\d\d,\d{4}-\d\d-\d\d$/);
  });

  it('tallies distinct species overall and for the six leading classes', async () => {
    const calls = stubNetwork((url) => {
      if (url.pathname === '/v1/occurrence/search') {
        const taxon = url.searchParams.get('taxonKey');
        return taxon === '212'
          ? facets(5, 'SPECIES_KEY', [[1, 5]])
          : facets(9, 'SPECIES_KEY', [
              [2, 6],
              [1, 3],
            ]);
      }
      return snapshots({ names: NAMES })(url);
    });
    const { speciesTallies } = await load();
    const classes = Array.from({ length: 7 }, (_, i) => ({ key: i === 0 ? 212 : 1000 + i, name: `C${i}`, records: 1 }));
    const t = await speciesTallies(AREA, classes);
    expect(t.total).toBe(2);
    expect(t.topNames).toEqual(['Passer domesticus', 'European robin']);
    expect(t.groups).toHaveLength(6);
    expect(t.groups[0]).toMatchObject({ key: 212, species: 1, topNames: ['European robin'] });
    // One request overall plus one per group.
    expect(calls.filter((u) => u.pathname === '/v1/occurrence/search')).toHaveLength(7);
  });
});
