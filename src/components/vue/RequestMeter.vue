<script setup lang="ts">
/**
 * Request meter (dev, or any build with ?debug=requests). Counts what this
 * page asked GBIF / the edge for in this session, to size Worker quotas.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { $requestCounts, edgeAvailable, edgeConfigured, resetRequestCounts } from '~/lib/gbif';

const counts = useStore($requestCounts);
const enabled = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  enabled.value = import.meta.env.DEV || new URLSearchParams(window.location.search).get('debug') === 'requests';
  if (enabled.value) timer = setInterval(() => (now.value = Date.now()), 5000);
});
onBeforeUnmount(() => clearInterval(timer));

const total = computed(() => counts.value.tile + counts.value.json + counts.value.image);
const minutes = computed(() => Math.max(0, Math.round((now.value - counts.value.startedAt) / 60_000)));
const edgeState = computed(() => (!edgeConfigured() ? 'off' : edgeAvailable(now.value) ? 'on' : 'bypassed'));
</script>

<template>
  <aside
    v-if="enabled"
    class="fixed bottom-3 right-14 z-40 rounded-md border border-border bg-surface/95 px-3 py-2 text-[11px] text-muted shadow-panel backdrop-blur"
    aria-label="GBIF request meter"
  >
    <p class="mb-1 font-medium text-text">GBIF requests · {{ minutes }} min</p>
    <dl class="grid grid-cols-[auto_auto] gap-x-3 tabular-nums">
      <dt>Tiles</dt>
      <dd class="text-right">{{ counts.tile }}</dd>
      <dt>JSON</dt>
      <dd class="text-right">{{ counts.json }}</dd>
      <dt>Images</dt>
      <dd class="text-right">{{ counts.image }}</dd>
      <dt class="font-medium text-text">Total</dt>
      <dd class="text-right font-medium text-text">{{ total }}</dd>
      <dt>Via edge ({{ edgeState }})</dt>
      <dd class="text-right">{{ counts.edge }}</dd>
    </dl>
    <button type="button" class="mt-1 underline-offset-2 hover:text-text hover:underline" @click="resetRequestCounts">
      Reset
    </button>
  </aside>
</template>
