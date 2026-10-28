/** Exact cell counts for the hover tooltip: debounced, fetched once, cached per filter and cell. */
export {};
const occurrenceCount = vi.fn();
const searchOccurrences = vi.fn();
vi.mock('~/lib/gbif', () => ({ occurrenceCount, searchOccurrences }));

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

  it('knows whether a filter has any empty cell, and keeps it past the counts it outlives', async () => {
    const { checkCells, fetchCount, hasKnownEmpty, knownCount, rememberCount } = await load();
    const filter = { taxonKey: 1 };
    expect(hasKnownEmpty(filter)).toBe(false);
    rememberCount(filter, CELL_A, 0);
    expect(hasKnownEmpty(filter)).toBe(true);
    expect(hasKnownEmpty({ taxonKey: 2 })).toBe(false);
    // A view can hold more sparse cells than the counts kept; a forgotten empty cell would be drawn and checked again.
    for (let index = 0; index < 500; index++) rememberCount(NONE, `cell${index}`, 1);
    expect(hasKnownEmpty(filter)).toBe(true);
    expect(knownCount(filter, CELL_A)).toBe(0);
    expect(await fetchCount(filter, CELL_A)).toBe(0);
    expect(await checkCells(filter, [CELL_A])).toBe(false);
    expect(occurrenceCount).not.toHaveBeenCalled();
    // A later count wins.
    rememberCount(filter, CELL_A, 3);
    expect(hasKnownEmpty(filter)).toBe(false);
  });

  it('keeps the most recent 20,000 empty cells per filter', async () => {
    const { knownCount, rememberCount } = await load();
    for (let index = 0; index <= 20_000; index++) rememberCount(NONE, `empty${index}`, 0);
    expect(knownCount(NONE, 'empty0')).toBeUndefined();
    expect(knownCount(NONE, 'empty20000')).toBe(0);
  });

  it('keeps the most recent 500 cells', async () => {
    const { knownCount, rememberCount } = await load();
    for (let index = 0; index < 501; index++) rememberCount(NONE, `cell${index}`, index + 1);
    expect(knownCount(NONE, 'cell0')).toBeUndefined();
    expect(knownCount(NONE, 'cell500')).toBe(501);
  });
});

describe('checkCells', () => {
  const SQUARE_A = 'POLYGON((0 0,1 0,1 1,0 1,0 0))';
  const SQUARE_B = 'POLYGON((2 0,3 0,3 1,2 1,2 0))';
  const recordAt = (decimalLongitude: number, decimalLatitude: number) => ({ decimalLongitude, decimalLatitude });

  it('counts every cell from one search and reports the empty ones', async () => {
    const { checkCells, knownCount } = await load();
    searchOccurrences.mockResolvedValue({ count: 2, results: [recordAt(0.5, 0.5), recordAt(0.2, 0.8)] });
    await expect(checkCells(NONE, [SQUARE_A, SQUARE_B])).resolves.toBe(true);
    expect(searchOccurrences).toHaveBeenCalledOnce();
    expect(searchOccurrences.mock.calls[0]![0]).toEqual({ geometry: [SQUARE_A, SQUARE_B] });
    expect(knownCount(NONE, SQUARE_A)).toBe(2);
    expect(knownCount(NONE, SQUARE_B)).toBe(0);
    // Known cells are not asked for again.
    await checkCells(NONE, [SQUARE_A, SQUARE_B]);
    expect(searchOccurrences).toHaveBeenCalledOnce();
  });

  it('tallies records on either side of a cell split at the antimeridian', async () => {
    const { checkCells, knownCount } = await load();
    const split = 'MULTIPOLYGON(((-180 0,-179 0,-179 1,-180 1,-180 0)),((179 0,180 0,180 1,179 1,179 0)))';
    searchOccurrences.mockResolvedValue({ count: 2, results: [recordAt(-179.5, 0.5), recordAt(179.5, 0.5)] });
    await checkCells(NONE, [split, SQUARE_A]);
    expect(knownCount(NONE, split)).toBe(2);
  });

  it('records nothing from an incomplete page or a record outside every cell', async () => {
    const { checkCells, knownCount } = await load();
    searchOccurrences.mockResolvedValueOnce({ count: 500, results: [recordAt(0.5, 0.5)] });
    await expect(checkCells(NONE, [SQUARE_A, SQUARE_B])).resolves.toBe(false);
    searchOccurrences.mockResolvedValueOnce({ count: 1, results: [recordAt(9, 9)] });
    await expect(checkCells(NONE, [SQUARE_A, SQUARE_B])).resolves.toBe(false);
    expect(knownCount(NONE, SQUARE_B)).toBeUndefined();
  });

  it('treats a record with no coordinates as outside every cell', async () => {
    const { checkCells, knownCount } = await load();
    searchOccurrences.mockResolvedValueOnce({ count: 1, results: [{}] });
    await expect(checkCells(NONE, [SQUARE_A])).resolves.toBe(false);
    expect(knownCount(NONE, SQUARE_A)).toBeUndefined();
  });
});
