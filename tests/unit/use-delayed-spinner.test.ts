/** The spinner stays away for quick loads, and goes as soon as a slow one ends. */
import { effectScope, nextTick, ref } from 'vue';
import { SPINNER_DELAY_MS, useDelayedSpinner } from '~/composables/useDelayedSpinner';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDelayedSpinner', () => {
  it('never shows for a load that ends inside the delay', async () => {
    const isLoading = ref(true);
    const isSpinning = useDelayedSpinner(isLoading);

    vi.advanceTimersByTime(SPINNER_DELAY_MS - 1);
    isLoading.value = false;
    await nextTick();
    vi.advanceTimersByTime(SPINNER_DELAY_MS);

    expect(isSpinning.value).toBe(false);
  });

  it('shows after the delay and hides when the load ends', async () => {
    const isLoading = ref(true);
    const isSpinning = useDelayedSpinner(isLoading);

    vi.advanceTimersByTime(SPINNER_DELAY_MS);
    expect(isSpinning.value).toBe(true);

    isLoading.value = false;
    await nextTick();
    expect(isSpinning.value).toBe(false);
  });

  it('drops its timer when its component goes away', () => {
    const scope = effectScope();
    const isSpinning = scope.run(() => useDelayedSpinner(ref(true)));

    scope.stop();
    vi.advanceTimersByTime(SPINNER_DELAY_MS);

    expect(isSpinning?.value).toBe(false);
  });
});
