// @vitest-environment jsdom
/** Moving the map to a taxon's records, after a search pick or when a link names taxa but no view. */
import { memoryStorage } from './helpers/storage';

const recordsView = vi.fn();

vi.mock('~/lib/map/taxonView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/map/taxonView')>()),
  recordsView: (...args: unknown[]) => recordsView(...args),
}));

const SOME_RECORDS = { extent: [-10, 40, 10, 60], busiest: [2, 48] };

async function stores(search = '') {
  vi.resetModules();
  history.replaceState(null, '', `/${search}`);
  const [flyToTaxa, explorer, fitSearch, near] = await Promise.all([
    import('~/stores/fly-to-taxa'),
    import('~/stores/explorer'),
    import('~/stores/fit-search'),
    import('~/stores/near'),
  ]);
  return { ...flyToTaxa, ...explorer, ...fitSearch, ...near };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  recordsView.mockReset();
  recordsView.mockResolvedValue(SOME_RECORDS);
});
afterEach(() => vi.unstubAllGlobals());

describe('flyToRecords', () => {
  it('flies to the box around the records, centred on the busiest place and not zoomed in past the cap', async () => {
    const { flyToRecords, $flyTo } = await stores();
    await flyToRecords({ taxonKeys: [212] });
    expect(recordsView).toHaveBeenCalledWith({ taxonKeys: [212] });
    expect($flyTo.get()).toMatchObject({ kind: 'bounds', centre: [2, 48], maxZoom: 6 });
  });

  it('uses the map’s current filter when given none', async () => {
    const { flyToRecords, $occurrenceFilter } = await stores('?taxon=212');
    await flyToRecords();
    expect(recordsView).toHaveBeenCalledWith($occurrenceFilter.get());
  });

  it('stays where it is when there are no records or the lookup fails', async () => {
    const { flyToRecords, $flyTo } = await stores();
    recordsView.mockResolvedValueOnce(null);
    await flyToRecords({});
    recordsView.mockRejectedValueOnce(new Error('offline'));
    await flyToRecords({});
    expect($flyTo.get()).toBeNull();
  });
});

describe('shouldFitTaxa', () => {
  it('is on only when the setting is on and Near me is off', async () => {
    const { shouldFitTaxa, setFitOnSearch, $nearMode } = await stores();
    expect(shouldFitTaxa()).toBe(true);
    $nearMode.set(true);
    expect(shouldFitTaxa()).toBe(false);
    $nearMode.set(false);
    setFitOnSearch(false);
    expect(shouldFitTaxa()).toBe(false);
  });
});

describe('flyToLinkedTaxa', () => {
  it('goes to the records of taxa a link names without a view', async () => {
    const { flyToLinkedTaxa } = await stores('?taxon=212');
    flyToLinkedTaxa();
    expect(recordsView).toHaveBeenCalledOnce();
  });

  it.each([
    ['names no taxa', ''],
    ['names a view too', '?taxon=212&view=1,2,3'],
  ])('stays put when the link %s', async (_name, search) => {
    const { flyToLinkedTaxa } = await stores(search);
    flyToLinkedTaxa();
    expect(recordsView).not.toHaveBeenCalled();
  });

  it('stays put when moving to search picks is turned off', async () => {
    const { flyToLinkedTaxa, setFitOnSearch } = await stores('?taxon=212');
    setFitOnSearch(false);
    flyToLinkedTaxa();
    expect(recordsView).not.toHaveBeenCalled();
  });
});
