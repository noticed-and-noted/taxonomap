<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { binLabels, rampColors } from '~/lib/ramp';
import { $mapView } from '~/stores/explorer';

const view = useStore($mapView);
const colors = ref<string[]>(rampColors());
// Bins scale with zoom (cells cover more ground when zoomed out).
const labels = computed(() => binLabels(view.value.zoom));

let observer: MutationObserver | undefined;
onMounted(() => {
  observer = new MutationObserver(() => (colors.value = rampColors()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div
    class="map-legend"
    role="img"
    :aria-label="`Records per hexagon, on a logarithmic scale from ${labels[0]} to over ${labels[labels.length - 1]} at this zoom`"
  >
    <p class="mb-1 text-[11px] font-medium text-muted">Records per cell</p>
    <div class="flex h-2.5 overflow-hidden rounded-sm">
      <span v-for="c in colors" :key="c" class="flex-1" :style="{ background: c }"></span>
    </div>
    <!-- Every other bin boundary, so labels never collide at narrow widths. -->
    <div class="relative mt-0.5 h-3.5 text-[10px] text-subtle tabular-nums" aria-hidden="true">
      <span
        v-for="(l, i) in labels"
        v-show="i % 2 === 0"
        :key="i"
        class="absolute top-0"
        :style="{ left: `${(i / labels.length) * 100}%` }"
        >{{ l }}</span
      >
    </div>
  </div>
</template>
