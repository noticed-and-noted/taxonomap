import { debounce } from '~/lib/util/debounce';

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
