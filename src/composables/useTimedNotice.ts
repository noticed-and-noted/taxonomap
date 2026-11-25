import { onScopeDispose, ref, type Ref } from 'vue';

/**
 * A short note that clears itself after `durationMs`; a new one restarts the clock.
 * @returns The note's text (empty when none) and a function that shows one.
 */
export function useTimedNotice(durationMs: number): { notice: Ref<string>; announce: (text: string) => void } {
  const notice = ref('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function announce(text: string) {
    notice.value = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = ''), durationMs);
  }

  onScopeDispose(() => clearTimeout(noticeTimer));

  return { notice, announce };
}
