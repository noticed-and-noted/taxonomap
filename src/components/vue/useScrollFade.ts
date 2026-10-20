/**
 * Which edges of a scroll box have more content beyond them, for soft edge
 * fades (see .fade-list in global.css). Call `update` on scroll and whenever
 * the content changes.
 */
import { ref, type Ref } from 'vue';

/**
 * Tracks whether a scroll box has more content above or below.
 * @param scrollBox The scrollable element.
 * @returns `fadeTop` and `fadeBottom` flags and `update` to call on scroll and content change.
 */
export function useScrollFade(scrollBox: Ref<HTMLElement | undefined>) {
  const fadeTop = ref(false);
  const fadeBottom = ref(false);
  function update() {
    const element = scrollBox.value;
    fadeTop.value = !!element && element.scrollTop > 1;
    fadeBottom.value = !!element && element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  }
  return { fadeTop, fadeBottom, update };
}
