import { debounce, throttle } from '~/lib/util/debounce';

describe('debounce', () => {
  it('fires once with the last arguments after 250 ms', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 250);
    d('a');
    d('ab');
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    d('abc');
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('abc');
    vi.useRealTimers();
  });
});

describe('debounce controls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancel drops the pending call; flush runs it now', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    d('b');
    d.flush();
    expect(fn).toHaveBeenCalledWith('b');
    d.flush();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the first call at once and the last one at the end of the window', () => {
    const fn = vi.fn();
    const t = throttle(fn, 300);
    t(1);
    t(2);
    t(3);
    expect(fn.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(300);
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });
});
