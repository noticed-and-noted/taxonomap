import { onScopeDispose, ref, watch, type Ref, type WatchSource } from 'vue';

/** Loads quicker than this finish without the spinner flashing up. */
export const SPINNER_DELAY_MS = 300;

/**
 * Whether to show a spinner: true once `isLoading` has held for SPINNER_DELAY_MS, false as soon as it ends.
 * @param isLoading Whether the thing is loading right now.
 */
export function useDelayedSpinner(isLoading: WatchSource<boolean>): Ref<boolean> {
  const isSpinning = ref(false);
  let spinnerTimer: ReturnType<typeof setTimeout> | undefined;

  watch(
    isLoading,
    (isLoadingNow) => {
      clearTimeout(spinnerTimer);
      if (isLoadingNow) spinnerTimer = setTimeout(() => (isSpinning.value = true), SPINNER_DELAY_MS);
      else isSpinning.value = false;
    },
    { immediate: true },
  );

  onScopeDispose(() => clearTimeout(spinnerTimer));

  return isSpinning;
}
