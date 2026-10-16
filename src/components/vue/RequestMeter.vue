<script setup lang="ts">
/**
 * Request meter (dev, or any build with ?debug=requests). Counts what this
 * page asked GBIF / the edge for in this session, to size Worker quotas.
 * Ctrl+D shows / hides it; the choice is remembered per browser.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { $requestCounts, edgeAvailable, edgeConfigured, resetRequestCounts } from '~/lib/gbif';
import { MINUTE } from '~/lib/util/time';

const counts = useStore($requestCounts);
const enabled = ref(false);
const visible = ref(true);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

const HIDDEN_KEY = 'gbif:request-meter-hidden';

function onKey(e: KeyboardEvent) {
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'd') return;
  e.preventDefault();
  visible.value = !visible.value;
  try {
    localStorage.setItem(HIDDEN_KEY, visible.value ? '0' : '1');
  } catch {
    // Storage unavailable; the toggle still works for this page.
  }
}

onMounted(() => {
  enabled.value = import.meta.env.DEV || new URLSearchParams(window.location.search).get('debug') === 'requests';
  if (!enabled.value) return;
  try {
    visible.value = localStorage.getItem(HIDDEN_KEY) !== '1';
  } catch {
    // Storage unavailable; default to visible.
  }
  timer = setInterval(() => (now.value = Date.now()), 5000);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('keydown', onKey);
});

const total = computed(() => counts.value.tile + counts.value.json + counts.value.image);
const minutes = computed(() => Math.max(0, Math.round((now.value - counts.value.startedAt) / MINUTE)));
const edgeState = computed(() => (!edgeConfigured() ? 'off' : edgeAvailable(now.value) ? 'on' : 'bypassed'));
</script>

<template>
  <aside
    v-if="enabled && visible"
    class="fixed left-16 top-1/2 z-40 -translate-y-1/2 rounded-md border border-border bg-surface/95 px-3 py-2 text-[11px] text-muted shadow-panel backdrop-blur"
    aria-label="GBIF request meter"
  >
    <p class="mb-1 font-medium text-text">GBIF requests · {{ minutes }} min</p>
    <p class="mb-1">Ctrl+D to hide</p>
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
