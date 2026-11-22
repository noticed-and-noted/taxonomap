import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue';

/** Options for `useKeyboardFit`. */
export interface KeyboardFitOptions {
  /** The least height, in px, however little room is left. */
  minHeight: number;
  /** Room kept between the element's foot and the visible area's, in px. */
  margin: number;
}

/**
 * A max height that keeps a dropdown's foot inside the visible area. On-screen keyboards shrink the visual
 * viewport (not the layout one) on iOS and Android, which would hide it.
 * @param isShown Whether the dropdown shows; hidden (v-show) it measures at top 0, so it is only sized while shown.
 * @returns The height in px, or null until first measured.
 */
export function useKeyboardFit(
  element: Ref<HTMLElement | undefined>,
  isShown: Ref<boolean>,
  { minHeight, margin }: KeyboardFitOptions,
): Ref<number | null> {
  const fitHeight = ref<number | null>(null);
  let isListening = false;

  function fit() {
    if (!element.value) return;
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    fitHeight.value = Math.max(minHeight, Math.floor(bottom - element.value.getBoundingClientRect().top - margin));
  }

  function listen() {
    isListening = true;
    window.visualViewport?.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
  }

  function stopListening() {
    if (!isListening) return;
    isListening = false;
    window.visualViewport?.removeEventListener('resize', fit);
    window.visualViewport?.removeEventListener('scroll', fit);
    window.removeEventListener('resize', fit);
  }

  // On first use the content arrives after the dropdown opens, so fit when it actually shows.
  watch(isShown, (shown) => {
    if (!shown) return stopListening();
    listen();
    void nextTick(fit);
  });

  onScopeDispose(stopListening);

  return fitHeight;
}
