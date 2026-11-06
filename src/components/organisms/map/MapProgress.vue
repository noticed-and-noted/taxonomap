<script setup lang="ts">
/**
 * The map's status column: the new-version and "GBIF is busy" notes, then the tile loading ring
 * ("40 / 60 tiles") below it. The ring fades in only for loads that last, and
 * lingers briefly after the map goes idle, so quick pans don't make it flicker.
 * The notes slide open and shut, so whatever sits below moves smoothly.
 */
import { useStore } from '@nanostores/vue';
import { onBeforeUnmount, ref, watch } from 'vue';
import BusyNotice from '~/components/molecules/BusyNotice.vue';
import TilesNotice from '~/components/molecules/TilesNotice.vue';
import UpdateNotice from '~/components/molecules/UpdateNotice.vue';
import { $gbifStale } from '~/lib/gbif';
import { $applyUpdate } from '~/stores/app-update';
import { $mapLoad, $tilesFailed } from '~/stores/explorer';

/** Loads quicker than this never show the ring. */
const SHOW_DELAY = 150;
/** How long the ring stays after the map goes idle (a new load in that time keeps it). */
const HIDE_DELAY = 700;
/** Ring arc length: the circle's circumference (r = 9). */
const RING = 2 * Math.PI * 9;

const load = useStore($mapLoad);
const stale = useStore($gbifStale);
const tilesFailed = useStore($tilesFailed);
const applyUpdate = useStore($applyUpdate);
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => load.value.loading,
  (loading) => {
    clearTimeout(timer);
    if (loading === visible.value) return;
    timer = setTimeout(() => (visible.value = loading), loading ? SHOW_DELAY : HIDE_DELAY);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="map-status">
    <Transition name="slide">
      <div v-if="applyUpdate" class="slide-box">
        <div class="slide-inner"><UpdateNotice class="note" /></div>
      </div>
    </Transition>
    <!-- Both notes link GBIF's status; the tile note says more, so it stands in for the busy one. -->
    <Transition name="slide">
      <div v-if="tilesFailed" class="slide-box">
        <div class="slide-inner"><TilesNotice class="note" /></div>
      </div>
      <div v-else-if="stale" class="slide-box">
        <div class="slide-inner"><BusyNotice class="note" /></div>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="visible" class="map-progress" role="status" data-testid="map-progress">
        <svg viewBox="0 0 24 24" class="size-5 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="9" class="track" />
          <circle
            cx="12"
            cy="12"
            r="9"
            class="arc"
            :class="{ indeterminate: !load.total }"
            :stroke-dasharray="RING"
            :stroke-dashoffset="load.total ? RING * (1 - load.done / load.total) : RING * 0.75"
          />
        </svg>
        <span v-if="load.total" class="tabular-nums">{{ load.done }} / {{ load.total }} tiles</span>
        <span v-else>Loading map</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.map-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: max-content;
  /* Notes wrap rather than run off a phone screen; a parent narrows this to clear its own panels. */
  max-width: var(--map-status-max-width, calc(100vw - 1.5rem));
  pointer-events: none;
}

/* Grows from 0 to its note's height (grid rows animate where height: auto can't), pushing the ring down. */
.slide-box {
  display: grid;
  grid-template-rows: 1fr;
}
.slide-inner {
  min-height: 0;
}
.note {
  margin-bottom: 0.5rem;
  pointer-events: auto;
}
.slide-enter-active,
.slide-leave-active {
  transition:
    grid-template-rows var(--dur) var(--ease),
    opacity var(--dur) var(--ease);
}
/* Clip only while it slides; at rest the note's shadow shows. */
.slide-enter-active .slide-inner,
.slide-leave-active .slide-inner {
  overflow: hidden;
}
.slide-enter-from,
.slide-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

.map-progress {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem 0 0.375rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.75rem;
  box-shadow: var(--shadow);
  pointer-events: none;
}

.map-progress circle {
  fill: none;
  stroke-width: 3;
}

.track {
  stroke: var(--border);
}

.arc {
  stroke: var(--accent);
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dashoffset var(--dur) var(--ease);
}

.arc.indeterminate {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(-90deg);
  }
  to {
    transform: rotate(270deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .arc.indeterminate {
    animation: none;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-slow) var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
