/** Place search as you type: debounced, stale answers dropped. */
import { effectScope } from 'vue';
import { usePlaceSearch } from '~/composables/usePlaceSearch';
import { stubNetwork } from './helpers/network';

const photon = (name: string) => ({ features: [{ geometry: { coordinates: [1, 2] }, properties: { name } }] });

function setup() {
  const scope = effectScope();
  const state = scope.run(usePlaceSearch)!;
  return { ...state, stop: () => scope.stop() };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePlaceSearch', () => {
  it('sends only the last of quick keystrokes, after the debounce', async () => {
    const calls = stubNetwork((url) => photon(url.searchParams.get('q')!));
    const { places, loading, answered, search, stop } = setup();
    search('lo');
    search('lon');
    search('london');
    expect(loading.value).toBe(true);
    expect(calls).toHaveLength(0);
    await vi.runAllTimersAsync();
    expect(calls.map((url) => url.searchParams.get('q'))).toEqual(['london']);
    expect(places.value.map((place) => place.name)).toEqual(['london']);
    expect(loading.value).toBe(false);
    expect(answered.value).toBe(true);
    stop();
  });

  it('drops an answer that arrives after newer typing', async () => {
    let release: () => void = () => undefined;
    stubNetwork(async (url) => {
      const text = url.searchParams.get('q')!;
      if (text === 'paris') await new Promise<void>((resolve) => (release = resolve));
      return photon(text);
    });
    const { places, search, flush, stop } = setup();
    search('paris');
    flush();
    search('rome');
    flush();
    release();
    await vi.runAllTimersAsync();
    expect(places.value.map((place) => place.name)).toEqual(['rome']);
    stop();
  });

  it('stays quiet when a search in flight is reset', async () => {
    stubNetwork(
      (_url, requestInit) =>
        new Promise((_resolve, reject) =>
          requestInit?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    );
    const { places, failed, search, flush, reset, stop } = setup();
    search('paris');
    flush();
    await vi.advanceTimersByTimeAsync(0);
    reset();
    await vi.runAllTimersAsync();
    expect(places.value).toEqual([]);
    expect(failed.value).toBe(false);
    stop();
  });

  it('skips one-letter queries and clears on reset', async () => {
    const calls = stubNetwork(() => photon('x'));
    const { places, loading, search, reset, stop } = setup();
    search('a');
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(0);
    search('athens');
    reset();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(0);
    expect(places.value).toEqual([]);
    expect(loading.value).toBe(false);
    stop();
  });

  it('flags a failed search', async () => {
    stubNetwork(() => new Response('', { status: 503 }));
    const { failed, loading, search, stop } = setup();
    search('oslo');
    await vi.runAllTimersAsync();
    expect(failed.value).toBe(true);
    expect(loading.value).toBe(false);
    stop();
  });
});
