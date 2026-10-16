/** Exact cell counts for the hover tooltip: debounced, fetched once, cached per filter and cell. */
export {};
const occurrenceCount = vi.fn();
vi.mock('~/lib/gbif', () => ({ occurrenceCount }));

async function load() {
  vi.resetModules();
  return import('~/lib/map/cellCounts');
}

const A = 'POLYGON((0 0,1 0,1 1,0 0))';
const B = 'POLYGON((2 2,3 2,3 3,2 2))';
const NONE = {};

beforeEach(() => {
  vi.useFakeTimers();
  occurrenceCount.mockReset();
  occurrenceCount.mockImplementation((f: { geometry: string }) => Promise.resolve(f.geometry === A ? 11 : 22));
});
afterEach(() => vi.useRealTimers());

describe('createHoverCounter', () => {
  it('fetches only once the pointer has rested on a cell', async () => {
    const { createHoverCounter, HOVER_DELAY_MS, knownCount } = await load();
    const onCount = vi.fn();
    const c = createHoverCounter(onCount);
    c.hover(NONE, A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS - 1);
    // Moving within the cell keeps the running wait.
    c.hover(NONE, A);
    expect(occurrenceCount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(occurrenceCount).toHaveBeenCalledOnce();
    expect(occurrenceCount).toHaveBeenCalledWith({ geometry: A });
    expect(onCount).toHaveBeenCalledWith(A, 11);
    expect(knownCount(NONE, A)).toBe(11);
  });

  it('skips cells passed over, and cells left before their count arrives', async () => {
    const { createHoverCounter, HOVER_DELAY_MS } = await load();
    const onCount = vi.fn();
    const c = createHoverCounter(onCount);
    c.hover(NONE, A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS / 2);
    c.hover(NONE, B);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(occurrenceCount).toHaveBeenCalledOnce();
    expect(onCount).toHaveBeenCalledWith(B, 22);

    let resolve!: (n: number) => void;
    occurrenceCount.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    c.hover(NONE, A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    c.cancel();
    resolve(11);
    await vi.runAllTimersAsync();
    expect(onCount).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a known count, and counts per filter', async () => {
    const { createHoverCounter, rememberCount, HOVER_DELAY_MS } = await load();
    rememberCount(NONE, A, 5);
    const c = createHoverCounter(vi.fn());
    c.hover(NONE, A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(occurrenceCount).not.toHaveBeenCalled();
    c.hover({ taxonKey: 212 }, A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(occurrenceCount).toHaveBeenCalledWith({ taxonKey: 212, geometry: A });
  });
});

describe('fetchCount', () => {
  it('shares one request between callers', async () => {
    const { fetchCount } = await load();
    expect(await Promise.all([fetchCount(NONE, A), fetchCount(NONE, A)])).toEqual([11, 11]);
    expect(await fetchCount(NONE, A)).toBe(11);
    expect(occurrenceCount).toHaveBeenCalledOnce();
  });

  it('keeps the most recent 500 cells', async () => {
    const { knownCount, rememberCount } = await load();
    for (let i = 0; i < 501; i++) rememberCount(NONE, `cell${i}`, i);
    expect(knownCount(NONE, 'cell0')).toBeUndefined();
    expect(knownCount(NONE, 'cell500')).toBe(500);
  });
});
