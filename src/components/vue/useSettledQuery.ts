/**
 * A search box's text once typing pauses, so lookups that cost a request per
 * species start once per search rather than on every keystroke. Filtering
 * names already known can keep using the live text.
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { debounce } from '~/lib/util/debounce';

/** Pause after the last keystroke before a search's lookups start. */
const SETTLE_MS = 300;

/**
 * Follows `query` once it has stopped changing; clearing it applies at once.
 * @param query The search box's live text.
 * @returns `settled`, the text to look names up for, and `isSettling`, true while typing is still in progress.
 */
export function useSettledQuery(query: Ref<string>) {
  const settled = ref(query.value);
  const settle = debounce((text: string) => (settled.value = text), SETTLE_MS);

  watch(query, (text) => {
    if (text.trim()) {
      settle(text);
      return;
    }
    settle.cancel();
    settled.value = text;
  });

  onScopeDispose(settle.cancel);

  return { settled, isSettling: computed(() => query.value !== settled.value) };
}
