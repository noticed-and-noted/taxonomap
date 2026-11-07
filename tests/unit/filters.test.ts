import { filterToParams, hasRefinements, needsAdhoc, refinementParams, toQueryString } from '~/lib/gbif';
import { json, stubNetwork } from './helpers/network';

const PUBLISHER = '28eb1a3f-1c15-4a95-931a-4af90ecb574d';

describe('refinements', () => {
  it('maps every refinement to its GBIF search parameter', () => {
    const queryString = toQueryString(
      refinementParams({
        hasImage: true,
        hasSound: true,
        months: [5, 4],
        continents: ['EUROPE'],
        maxUncertaintyM: 1000,
        iucn: ['VU'],
      }),
    );
    expect(queryString).toBe(
      'continent=EUROPE&coordinateUncertaintyInMeters=0%2C1000&iucnRedListCategory=VU' +
        '&mediaType=Sound&mediaType=StillImage&month=4&month=5',
    );
  });

  it('omits unset refinements and keeps density tiles when none apply', () => {
    expect(toQueryString(refinementParams({ hasImage: false, months: undefined }))).toBe('');
    expect(hasRefinements({})).toBe(false);
    expect(needsAdhoc({ taxonKey: 212, basisOfRecord: ['HUMAN_OBSERVATION'], year: [1990, 2000] })).toBe(false);
  });

  it('switches tiles to adhoc for any refinement', () => {
    expect(needsAdhoc({ taxonKeys: [212, 359] })).toBe(true);
    expect(needsAdhoc({ taxonKeys: [212] })).toBe(false);
    expect(needsAdhoc({ months: [6] })).toBe(true);
    expect(needsAdhoc({ hasSound: true })).toBe(true);
    expect(needsAdhoc({ maxUncertaintyM: 10 })).toBe(true);
    expect(needsAdhoc({ publishers: [PUBLISHER] })).toBe(true);
  });

  it('sends publishers as a repeated publishingOrg', () => {
    expect(refinementParams({ publishers: [PUBLISHER] }).publishingOrg).toEqual([PUBLISHER]);
  });

  it('sends several taxa as a repeated taxonKey', () => {
    expect(filterToParams({ taxonKeys: [212, 359], taxonKey: 1 }).taxonKey).toEqual([212, 359]);
    expect(filterToParams({ taxonKey: 1 }).taxonKey).toBe(1);
  });

  it('lets a single month narrow the month refinement', () => {
    expect(filterToParams({ months: [4, 5] }).month).toEqual([4, 5]);
    expect(filterToParams({ months: [4, 5], month: 5 }).month).toBe(5);
  });
});

describe('explorer filter stores', () => {
  it('feed every URL filter into the occurrence filter, and clear them all', async () => {
    const explorer = await import('~/stores/explorer');
    explorer.$taxonKeys.set([212, 2492462]);
    explorer.$months.set([4]);
    explorer.$continents.set(['EUROPE']);
    explorer.$maxUncertainty.set(100);
    explorer.$iucn.set(['VU']);
    explorer.$hasSound.set(true);
    expect(explorer.$occurrenceFilter.get()).toMatchObject({
      taxonKeys: [212, 2492462],
      months: [4],
      continents: ['EUROPE'],
      maxUncertaintyM: 100,
      iucn: ['VU'],
      hasSound: true,
    });
    expect(explorer.$taxonKey.get()).toBeNull();
    explorer.clearFilters();
    expect(explorer.$occurrenceFilter.get()).toEqual({});
  });

  it('count set filters per rail group', async () => {
    const explorer = await import('~/stores/explorer');
    explorer.clearFilters();
    explorer.$taxonKeys.set([212, 2492462]);
    explorer.$iucn.set(['VU', 'EN']);
    explorer.$dateRange.set({ unit: 'y', from: '1990-01-01', to: '2000-12-31' });
    explorer.$hasPhoto.set(true);
    explorer.$hasSound.set(true);
    expect(explorer.$groupCounts.get()).toEqual({ what: 4, when: 1, where: 0, how: 2 });
    explorer.clearFilters();
    expect(Object.values(explorer.$groupCounts.get()).every((count) => count === 0)).toBe(true);
  });

  it('give each set filter but taxa a pill (one per value) that clears it', async () => {
    const explorer = await import('~/stores/explorer');
    explorer.clearFilters();
    explorer.$taxonKeys.set([212]);
    explorer.$iucn.set(['CR', 'VU']);
    explorer.$dateRange.set({ unit: 'y', from: '1990-01-01', to: '2000-12-31' });
    explorer.$months.set([4, 5]);
    explorer.$continents.set(['EUROPE', 'AFRICA']);
    explorer.$maxUncertainty.set(1000);
    explorer.$basisOfRecord.set(['HUMAN_OBSERVATION', 'PRESERVED_SPECIMEN']);
    explorer.$hasPhoto.set(true);
    expect(explorer.$filterPills.get().map((pill) => [pill.group, pill.text])).toEqual([
      ['what', 'Critically endangered'],
      ['what', 'Vulnerable'],
      ['when', '1990–2000'],
      ['when', 'Apr'],
      ['when', 'May'],
      ['where', 'Europe'],
      ['where', 'Africa'],
      ['where', 'Accuracy ≤ 1 km'],
      ['how', 'Human observation'],
      ['how', 'Preserved specimen'],
      ['how', 'Has photo'],
    ]);
    explorer.$filterPills.get()[0]?.clear();
    expect(explorer.$iucn.get()).toEqual(['VU']);
    explorer.$filterPills
      .get()
      .find((pill) => pill.text === '1990–2000')
      ?.clear();
    expect(explorer.$dateRange.get()).toBeNull();
    explorer.clearFilters();
    expect(explorer.$filterPills.get()).toEqual([]);
  });

  it('label one year, continents and record types', async () => {
    const explorer = await import('~/stores/explorer');
    explorer.clearFilters();
    explorer.$dateRange.set({ unit: 'y', from: '2001-01-01', to: '2001-12-31' });
    explorer.$continents.set(['EUROPE', 'ASIA']);
    explorer.$basisOfRecord.set(['HUMAN_OBSERVATION', 'FOSSIL_SPECIMEN']);
    expect(explorer.$filterPills.get().map((pill) => pill.text)).toEqual([
      '2001',
      'Europe',
      'Asia',
      'Human observation',
      'Fossil specimen',
    ]);
    explorer.clearFilters();
  });

  it('name publisher pills once their names are known, and clear them one at a time', async () => {
    const explorer = await import('~/stores/explorer');
    const publisher = await import('~/stores/publisher');
    explorer.clearFilters();
    publisher.addPublisher({ key: PUBLISHER, title: 'iNaturalist.org' });
    expect(explorer.$occurrenceFilter.get()).toEqual({ publishers: [PUBLISHER] });
    expect(explorer.$filterPills.get().map((pill) => [pill.group, pill.text])).toEqual([['how', 'iNaturalist.org']]);
    explorer.$filterPills.get()[0]?.clear();
    expect(publisher.$publisherKeys.get()).toEqual([]);
  });

  it('refuse a publisher twice or past the limit, and remove one by key', async () => {
    const publisher = await import('~/stores/publisher');
    const keys = Array.from({ length: publisher.MAX_PUBLISHERS }, (_unused, index) =>
      PUBLISHER.replace(/^.{2}/, String(index).padStart(2, '0')),
    );
    expect(publisher.addPublisher({ key: keys[0]!, title: 'First' })).toBe(true);
    expect(publisher.addPublisher({ key: keys[0]!, title: 'First' })).toBe(false);
    for (const key of keys.slice(1)) publisher.addPublisher({ key, title: key });
    expect(publisher.addPublisher({ key: PUBLISHER, title: 'One too many' })).toBe(false);
    publisher.removePublisher(keys[0]!);
    expect(publisher.$publisherKeys.get()).toHaveLength(publisher.MAX_PUBLISHERS - 1);
    publisher.$publisherKeys.set([]);
  });

  it('look up the names of publishers from a shared link while their pills are shown', async () => {
    const other = '00000000-0000-4000-8000-000000000000';
    stubNetwork((url) => {
      if (url.pathname === `/v1/organization/${PUBLISHER}`) return { key: PUBLISHER, title: 'iNaturalist.org' };
      return json({ message: 'gone' }, 404);
    });
    vi.resetModules();
    const publisher = await import('~/stores/publisher');
    expect(publisher.publisherName(PUBLISHER)).toBe(publisher.UNKNOWN_PUBLISHER);
    const stop = publisher.$publisherNames.listen(() => {});
    publisher.$publisherKeys.set([PUBLISHER, other]);
    await vi.waitFor(() => expect(publisher.publisherName(PUBLISHER)).toBe('iNaturalist.org'));
    expect(publisher.publisherName(other)).toBe(publisher.UNKNOWN_PUBLISHER);
    stop();
    publisher.$publisherKeys.set([]);
    vi.unstubAllGlobals();
  });

  it('read only organisation keys from a publisher link', async () => {
    const { codecs } = await import('~/stores/url-sync');
    const codec = codecs.stringSet('publisher', { pattern: /^[0-9a-f-]{36}$/, limit: 1 });
    expect(codec.parse(`not-a-key,${PUBLISHER},${PUBLISHER}`)).toEqual([PUBLISHER]);
    expect(codec.serialize(['b', 'a'])).toBe('a,b');
  });

  it('read a pre-multi-select taxon link as a one-item list', async () => {
    const { codecs } = await import('~/stores/url-sync');
    const codec = codecs.intSet('taxon', { min: 0, limit: 10 });
    expect(codec.parse('2492462')).toEqual([2492462]);
  });
});
