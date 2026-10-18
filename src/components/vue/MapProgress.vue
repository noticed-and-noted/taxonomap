<script setup lang="ts">
/**
 * Tile loading ring ("40 / 60 tiles") centred in the map's top row of pills.
 * Fades in only for loads that last, and lingers briefly after the map goes
 * idle, so quick pans don't make it flicker in and out.
 */
import { useStore } from '@nanostores/vue';
import { onBeforeUnmount, ref, watch } from 'vue';
import { $mapLoad } from '~/stores/explorer';

/** Loads quicker than this never show the ring. */
const SHOW_DELAY = 150;
/** How long the ring stays after the map goes idle (a new load in that time keeps it). */
const HIDE_DELAY = 700;
/** Ring arc length: the circle's circumference (r = 9). */
const RING = 2 * Math.PI * 9;

const load = useStore($mapLoad);
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
</template>

<style scoped>
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
