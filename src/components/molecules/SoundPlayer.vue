<script setup lang="ts">
/**
 * Plays a record's sound: a play button, a seekable progress line and the time, with the sound's licence.
 * Nothing is fetched until the viewer presses play, as the file comes straight from its publisher.
 */
import { computed, ref, useTemplateRef } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { LICENCE_URLS, type UsableSound } from '~/lib/gbif/licence';

const props = defineProps<{ sound: UsableSound }>();

const SECONDS_PER_MINUTE = 60;
const SEEK_STEP_SECONDS = 0.1;

const audio = useTemplateRef<HTMLAudioElement>('audio');
const isPlaying = ref(false);
const hasFailed = ref(false);
const currentSeconds = ref(0);
const durationSeconds = ref(0);

const credit = computed(() => props.sound.creator ?? props.sound.rightsHolder);
const progress = computed(() => (durationSeconds.value ? currentSeconds.value / durationSeconds.value : 0));

/** "m:ss", the way players show time. */
function clock(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(wholeSeconds % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

/** Plays or pauses the sound. */
function togglePlay() {
  if (!audio.value) return;
  if (isPlaying.value) audio.value.pause();
  else void audio.value.play().catch(markUnplayable);
}

/** Shows the failure note when the browser can't play the file; a play cut short by a pause (AbortError) isn't one. */
function markUnplayable(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotSupportedError') hasFailed.value = true;
}

/** Moves playback to where the viewer dragged or stepped the line. */
function seek(event: Event) {
  if (!audio.value) return;
  const line = event.target as HTMLInputElement;
  audio.value.currentTime = Number(line.value);
  // A host that won't serve byte ranges can't seek, so put the line back where the sound really is.
  currentSeconds.value = audio.value.currentTime;
  line.value = String(currentSeconds.value);
}

/** Records the sound's length once the browser knows it. */
function readDuration() {
  if (audio.value && Number.isFinite(audio.value.duration)) durationSeconds.value = audio.value.duration;
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <p v-if="hasFailed" class="text-xs text-subtle">This sound couldn't be played. It may still play on GBIF.</p>
    <div v-else class="player">
      <audio
        ref="audio"
        :src="sound.url"
        preload="none"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @timeupdate="currentSeconds = audio?.currentTime ?? 0"
        @loadedmetadata="readDuration"
        @durationchange="readDuration"
        @error="hasFailed = true"
      />
      <button
        type="button"
        class="play"
        :aria-label="isPlaying ? 'Pause sound' : 'Play sound'"
        :aria-pressed="isPlaying"
        @click="togglePlay"
      >
        <UiIcon :name="isPlaying ? 'pause' : 'play'" size="14" />
      </button>
      <input
        type="range"
        class="line"
        min="0"
        :max="durationSeconds"
        :step="SEEK_STEP_SECONDS"
        :value="currentSeconds"
        :style="{ '--progress': progress }"
        aria-label="Position in sound"
        :aria-valuetext="clock(currentSeconds)"
        @input="seek"
      />
      <span class="text-xs tabular-nums text-subtle">
        {{ clock(currentSeconds) }}<template v-if="durationSeconds"> / {{ clock(durationSeconds) }}</template>
      </span>
    </div>
    <p class="text-[0.6875rem] text-subtle [overflow-wrap:anywhere]">
      Sound ·
      <a :href="LICENCE_URLS[sound.licence]" target="_blank" rel="license noopener">{{ sound.licence }}</a>
      <template v-if="credit"> · © {{ credit }}</template>
    </p>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.375rem 0.625rem 0.375rem 0.375rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.play {
  display: grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  color: var(--text);
  transition: background-color var(--dur-fast) var(--ease);
}
.play:hover {
  background: var(--surface-3);
}
.play:focus-visible,
.line:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
/* A thin line that fills with the accent as the sound plays; the input stays tall enough to grab. */
.line {
  --thumb-size: 0.625rem;
  /* The thumb's centre travels between half a thumb in from each end, so the fill follows it there. */
  --filled: calc(var(--thumb-size) / 2 + (100% - var(--thumb-size)) * var(--progress));

  flex: 1;
  min-width: 0;
  height: 2rem;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}
.line::-webkit-slider-runnable-track {
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(to right, var(--accent) var(--filled), var(--border-strong) var(--filled));
}
.line::-moz-range-track {
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(to right, var(--accent) var(--filled), var(--border-strong) var(--filled));
}
.line::-webkit-slider-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  margin-top: calc(1px - var(--thumb-size) / 2);
  border: none;
  border-radius: 50%;
  background: var(--accent);
  appearance: none;
}
.line::-moz-range-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  border: none;
  border-radius: 50%;
  background: var(--accent);
}
@media (max-width: 767px) {
  .play,
  .line {
    height: 2.75rem;
  }
  .play {
    width: 2.75rem;
  }
}
</style>
