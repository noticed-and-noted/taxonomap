import { debounce, throttle } from '~/lib/util/debounce';

describe('debounce', () => {
  it('fires once with the last arguments after 250 ms', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debounced = debounce(callback, 250);
    debounced('a');
    debounced('ab');
    vi.advanceTimersByTime(249);
    expect(callback).not.toHaveBeenCalled();
    debounced('abc');
    vi.advanceTimersByTime(250);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('abc');
    vi.useRealTimers();
  });
});

describe('debounce controls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancel drops the pending call; flush runs it now', () => {
    const callback = vi.fn();
    const debounced = debounce(callback, 100);
    debounced('a');
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(callback).not.toHaveBeenCalled();
    debounced('b');
    debounced.flush();
    expect(callback).toHaveBeenCalledWith('b');
    debounced.flush();
    expect(callback).toHaveBeenCalledOnce();
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the first call at once and the last one at the end of the window', () => {
    const callback = vi.fn();
    const throttled = throttle(callback, 300);
    throttled(1);
    throttled(2);
    throttled(3);
    expect(callback.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(300);
    expect(callback.mock.calls).toEqual([[1], [3]]);
  });
});
