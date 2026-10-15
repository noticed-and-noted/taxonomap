/**
 * Which edges of a scroll box have more content beyond them, for soft edge
 * fades (see .fade-list in global.css). Call `update` on scroll and whenever
 * the content changes.
 */
import { ref, type Ref } from 'vue';

export function useScrollFade(el: Ref<HTMLElement | undefined>) {
  const fadeTop = ref(false);
  const fadeBottom = ref(false);
  function update() {
    const e = el.value;
    fadeTop.value = !!e && e.scrollTop > 1;
    fadeBottom.value = !!e && e.scrollTop + e.clientHeight < e.scrollHeight - 1;
  }
  return { fadeTop, fadeBottom, update };
}
