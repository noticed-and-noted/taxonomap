/**
 * Which edges of a scroll box have more content beyond them, for soft edge
 * fades (see .fade-list and .fade-row in global.css). Call `update` on scroll
 * and whenever the content changes.
 */
import { ref, type Ref } from 'vue';

/**
 * Tracks whether a scroll box has more content above, below or to either side.
 * @param scrollBox The scrollable element.
 * @returns `fadeTop`, `fadeBottom`, `fadeLeft` and `fadeRight` flags, and `update` to call on scroll and content change.
 */
export function useScrollFade(scrollBox: Ref<HTMLElement | undefined>) {
  const fadeTop = ref(false);
  const fadeBottom = ref(false);
  const fadeLeft = ref(false);
  const fadeRight = ref(false);
  function update() {
    const element = scrollBox.value;
    fadeTop.value = !!element && element.scrollTop > 1;
    fadeBottom.value = !!element && element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    fadeLeft.value = !!element && element.scrollLeft > 1;
    fadeRight.value = !!element && element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
  }
  return { fadeTop, fadeBottom, fadeLeft, fadeRight, update };
}
