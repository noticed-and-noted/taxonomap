<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { binLabels, rampColors } from '~/lib/ramp';
import { $gridLevel } from '~/stores/explorer';
import { $ramp } from '~/stores/ramp';

const level = useStore($gridLevel);
const colors = ref<string[]>(rampColors());
// Bins follow the hex grid level (cells cover more ground when zoomed out).
const labels = computed(() => binLabels(level.value));

let observer: MutationObserver | undefined;
let unlisten: (() => void) | undefined;
onMounted(() => {
  observer = new MutationObserver(() => (colors.value = rampColors()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  unlisten = $ramp.listen(() => (colors.value = rampColors()));
});
onBeforeUnmount(() => {
  observer?.disconnect();
  unlisten?.();
});
</script>

<template>
  <div
    class="map-legend"
    role="img"
    :aria-label="`Records per hexagon, on a logarithmic scale from ${labels[0]} to over ${labels[labels.length - 1]} at this zoom`"
  >
    <p class="mb-1 text-xs font-medium text-muted">Records per cell</p>
    <div class="flex h-2.5 overflow-hidden rounded-sm">
      <span v-for="colour in colors" :key="colour" class="flex-1" :style="{ background: colour }"></span>
    </div>
    <!-- Every other bin boundary, so labels never collide at narrow widths. -->
    <div class="relative mt-0.5 h-3.5 text-xs text-subtle tabular-nums" aria-hidden="true">
      <span
        v-for="(label, index) in labels"
        v-show="index % 2 === 0"
        :key="index"
        class="absolute top-0"
        :style="{ left: `${(index / labels.length) * 100}%` }"
        >{{ label }}</span
      >
    </div>
  </div>
</template>
