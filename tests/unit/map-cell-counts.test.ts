/** Exact cell counts for the hover tooltip: debounced, fetched once, cached per filter and cell. */
export {};
const occurrenceCount = vi.fn();
vi.mock('~/lib/gbif', () => ({ occurrenceCount }));

async function load() {
  vi.resetModules();
  return import('~/lib/map/cellCounts');
}

const CELL_A = 'POLYGON((0 0,1 0,1 1,0 0))';
const CELL_B = 'POLYGON((2 2,3 2,3 3,2 2))';
const NONE = {};

beforeEach(() => {
  vi.useFakeTimers();
  occurrenceCount.mockReset();
  occurrenceCount.mockImplementation((filter: { geometry: string }) =>
    Promise.resolve(filter.geometry === CELL_A ? 11 : 22),
  );
});
afterEach(() => vi.useRealTimers());

describe('createHoverCounter', () => {
  it('fetches only once the pointer has rested on a cell', async () => {
    const { createHoverCounter, HOVER_DELAY_MS, knownCount } = await load();
    const onCount = vi.fn();
    const counter = createHoverCounter(onCount);
    counter.hover(NONE, CELL_A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS - 1);
    // Moving within the cell keeps the running wait.
    counter.hover(NONE, CELL_A);
    expect(occurrenceCount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(occurrenceCount).toHaveBeenCalledOnce();
    expect(occurrenceCount).toHaveBeenCalledWith({ geometry: CELL_A });
    expect(onCount).toHaveBeenCalledWith(CELL_A, 11);
    expect(knownCount(NONE, CELL_A)).toBe(11);
  });

  it('skips cells passed over, and cells left before their count arrives', async () => {
    const { createHoverCounter, HOVER_DELAY_MS } = await load();
    const onCount = vi.fn();
    const counter = createHoverCounter(onCount);
    counter.hover(NONE, CELL_A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS / 2);
    counter.hover(NONE, CELL_B);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(occurrenceCount).toHaveBeenCalledOnce();
    expect(onCount).toHaveBeenCalledWith(CELL_B, 22);

    let resolve!: (count: number) => void;
    occurrenceCount.mockImplementationOnce(() => new Promise((release) => (resolve = release)));
    counter.hover(NONE, CELL_A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    counter.cancel();
    resolve(11);
    await vi.runAllTimersAsync();
    expect(onCount).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a known count, and counts per filter', async () => {
    const { createHoverCounter, rememberCount, HOVER_DELAY_MS } = await load();
    rememberCount(NONE, CELL_A, 5);
    const counter = createHoverCounter(vi.fn());
    counter.hover(NONE, CELL_A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(occurrenceCount).not.toHaveBeenCalled();
    counter.hover({ taxonKey: 212 }, CELL_A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(occurrenceCount).toHaveBeenCalledWith({ taxonKey: 212, geometry: CELL_A });
  });
});

describe('a failed count', () => {
  it('leaves the estimate up and is asked for again next time', async () => {
    const { createHoverCounter, HOVER_DELAY_MS, knownCount } = await load();
    const onCount = vi.fn();
    occurrenceCount.mockRejectedValueOnce(new Error('offline'));
    const counter = createHoverCounter(onCount);
    counter.hover(NONE, CELL_A);
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
    expect(onCount).not.toHaveBeenCalled();
    expect(knownCount(NONE, CELL_A)).toBeUndefined();
  });
});

describe('fetchCount', () => {
  it('shares one request between callers', async () => {
    const { fetchCount } = await load();
    expect(await Promise.all([fetchCount(NONE, CELL_A), fetchCount(NONE, CELL_A)])).toEqual([11, 11]);
    expect(await fetchCount(NONE, CELL_A)).toBe(11);
    expect(occurrenceCount).toHaveBeenCalledOnce();
  });

  it('keeps the most recent 500 cells', async () => {
    const { knownCount, rememberCount } = await load();
    for (let index = 0; index < 501; index++) rememberCount(NONE, `cell${index}`, index);
    expect(knownCount(NONE, 'cell0')).toBeUndefined();
    expect(knownCount(NONE, 'cell500')).toBe(500);
  });
});
