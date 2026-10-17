import { filterToParams, hasRefinements, needsAdhoc, refinementParams, toQueryString } from '~/lib/gbif';

describe('refinements', () => {
  it('maps every refinement to its GBIF search parameter', () => {
    const qs = toQueryString(
      refinementParams({
        hasImage: true,
        hasSound: true,
        months: [5, 4],
        continents: ['EUROPE'],
        maxUncertaintyM: 1000,
        iucn: ['VU'],
      }),
    );
    expect(qs).toBe(
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
    const e = await import('~/stores/explorer');
    e.$taxonKeys.set([212, 2492462]);
    e.$months.set([4]);
    e.$continents.set(['EUROPE']);
    e.$maxUncertainty.set(100);
    e.$iucn.set(['VU']);
    e.$hasSound.set(true);
    expect(e.$occurrenceFilter.get()).toMatchObject({
      taxonKeys: [212, 2492462],
      months: [4],
      continents: ['EUROPE'],
      maxUncertaintyM: 100,
      iucn: ['VU'],
      hasSound: true,
    });
    expect(e.$taxonKey.get()).toBeNull();
    e.clearFilters();
    expect(e.$occurrenceFilter.get()).toEqual({});
  });

  it('count set filters per rail group', async () => {
    const e = await import('~/stores/explorer');
    e.clearFilters();
    e.$taxonKeys.set([212]);
    e.$iucn.set(['VU']);
    e.$yearRange.set([1990, 2000]);
    e.$hasPhoto.set(true);
    e.$hasSound.set(true);
    expect(e.$groupCounts.get()).toEqual({ what: 2, when: 1, where: 0, how: 2 });
    e.clearFilters();
    expect(Object.values(e.$groupCounts.get()).every((n) => n === 0)).toBe(true);
  });

  it('read a pre-multi-select taxon link as a one-item list', async () => {
    const { codecs } = await import('~/stores/url-sync');
    const c = codecs.intSet('taxon', { min: 0, limit: 10 });
    expect(c.parse('2492462')).toEqual([2492462]);
  });
});
