// @vitest-environment jsdom
/** Whether a search pick moves the map: on unless turned off, and remembered. */
import { memoryStorage } from './helpers/storage';

async function store() {
  vi.resetModules();
  return import('~/stores/fit-search');
}

const blockedStorage = () => {
  const blocked = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: blocked, setItem: blocked, removeItem: blocked };
};

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('fit-on-search store', () => {
  it('is on by default, and remembers being turned off and on again', async () => {
    const fitSearch = await store();
    expect(fitSearch.$fitOnSearch.get()).toBe(true);
    fitSearch.setFitOnSearch(false);
    expect((await store()).$fitOnSearch.get()).toBe(false);
    fitSearch.setFitOnSearch(true);
    expect(localStorage.getItem(fitSearch.FIT_SEARCH_KEY)).toBeNull();
    expect((await store()).$fitOnSearch.get()).toBe(true);
  });

  it('stays on, and still changes for this page, when storage is blocked', async () => {
    vi.stubGlobal('localStorage', blockedStorage());
    const fitSearch = await store();
    expect(fitSearch.$fitOnSearch.get()).toBe(true);
    fitSearch.setFitOnSearch(false);
    expect(fitSearch.$fitOnSearch.get()).toBe(false);
  });
});
