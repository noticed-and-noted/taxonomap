<script setup lang="ts">
/**
 * Phase 1 stand-in for MapCanvas. It proves that the persisted map slot
 * survives ClientRouter navigation (the mount time and counter must not
 * reset) and that the URL-synced stores round-trip.
 */
import { useStore } from '@nanostores/vue';
import { onMounted, ref } from 'vue';
import { $mapView, $taxonKey } from '~/stores/explorer';

const view = useStore($mapView);
const taxon = useStore($taxonKey);
const mountedAt = ref('');
const clicks = ref(0);

onMounted(() => {
  mountedAt.value = new Date().toLocaleTimeString();
});

function nudge() {
  clicks.value++;
  const v = $mapView.get();
  $mapView.set({ ...v, lng: ((v.lng + 190) % 360) - 180 + 10 });
}

function pickRobin() {
  $taxonKey.set($taxonKey.get() === 2492462 ? null : 2492462);
}
</script>

<template>
  <div class="map-placeholder grid size-full place-items-center" data-testid="map-placeholder">
    <div class="rounded-lg border border-border bg-surface/80 p-5 text-sm text-muted shadow-panel backdrop-blur">
      <p class="font-display text-base text-text">Map goes here (Phase 2)</p>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>Mounted</dt>
        <dd data-testid="mounted-at">{{ mountedAt }}</dd>
        <dt>Clicks</dt>
        <dd data-testid="clicks">{{ clicks }}</dd>
        <dt>View</dt>
        <dd>{{ view.lng.toFixed(2) }}, {{ view.lat.toFixed(2) }} @ {{ view.zoom.toFixed(1) }}</dd>
        <dt>Taxon</dt>
        <dd data-testid="taxon">{{ taxon ?? '—' }}</dd>
      </dl>
      <div class="mt-4 flex gap-2">
        <button type="button" class="rounded-md bg-surface-2 px-3 py-1.5 text-text hover:bg-surface-3" @click="nudge">
          Pan (replace)
        </button>
        <button
          type="button"
          class="rounded-md bg-accent px-3 py-1.5 text-accent-contrast"
          data-testid="pick-taxon"
          @click="pickRobin"
        >
          Toggle robin (push)
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-placeholder {
  background:
    radial-gradient(circle at 30% 40%, color-mix(in srgb, var(--ramp-3) 25%, transparent), transparent 40%),
    radial-gradient(circle at 70% 60%, color-mix(in srgb, var(--ramp-5) 18%, transparent), transparent 35%), var(--bg);
}
</style>
