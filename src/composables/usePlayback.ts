/**
 * Play and pause for Analyse's timelines. While playing it steps on once per interval, but never before
 * `isReady` (the map has drawn the last step), so a slow connection slows the loop rather than skipping frames.
 */
import { onScopeDispose, ref } from 'vue';

/** At most one step per second: long enough to read the map. */
export const PLAY_INTERVAL_MS = 1000;
/** How often a waiting step checks again. */
const READY_POLL_MS = 100;

/** Plays a timeline: `step` moves it on, `isReady` says the last step has finished drawing. */
export function usePlayback(step: () => void, isReady: () => boolean) {
  const isPlaying = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastStepAt = 0;

  function tick() {
    if (Date.now() - lastStepAt < PLAY_INTERVAL_MS || !isReady()) return;
    lastStepAt = Date.now();
    step();
  }

  function pause() {
    clearInterval(timer);
    isPlaying.value = false;
  }

  function play() {
    isPlaying.value = true;
    // The first step waits a whole interval, so the step showing when Play was pressed is seen.
    lastStepAt = Date.now();
    timer = setInterval(tick, READY_POLL_MS);
  }

  const toggle = () => (isPlaying.value ? pause() : play());

  onScopeDispose(pause);

  return { isPlaying, toggle, pause };
}
