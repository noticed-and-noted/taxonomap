<script setup lang="ts">
/**
 * Distribution mini-map: the world at zoom 1 (2×2 tiles of GBIF's basemap
 * with the same hex density layer as the explorer, as PNG). No MapLibre, so
 * species pages stay light. Links to the explorer filtered to the taxon.
 */
import { computed, onMounted, ref } from 'vue';
import { gbifBasemapTile, isEdgeUrl, markEdgeDown, occurrenceTileUrl } from '~/lib/gbif';

const props = defineProps<{ taxonKey: number; label: string }>();

const Z = 1;
const tiles = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;
const retry = ref(0);

const density = computed(() =>
  tiles.map(([x, y]) =>
    retry.value >= 0
      ? occurrenceTileUrl({ taxonKey: props.taxonKey }, Z, x, y, {
          hexPerTile: 45,
          style: 'purpleYellow-noborder.poly',
        })
      : '',
  ),
);

const root = ref<HTMLElement>();

/** Empty tiles come back with no content: hide them. Edge failures retry direct. */
function handleBroken(img: HTMLImageElement) {
  if (isEdgeUrl(img.src) && retry.value === 0) {
    markEdgeDown();
    retry.value++;
    return;
  }
  img.style.visibility = 'hidden';
}

function onDensityError(e: Event) {
  handleBroken(e.target as HTMLImageElement);
}

// Errors that happened before hydration.
onMounted(() => {
  root.value?.querySelectorAll<HTMLImageElement>('img[data-density]').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) handleBroken(img);
  });
});
</script>

<template>
  <figure ref="root" class="mini-map">
    <a
      :href="`/?taxon=${taxonKey}`"
      class="group relative block aspect-square overflow-hidden rounded-md border border-border"
      :aria-label="`Open the map of ${label} records`"
    >
      <span class="grid size-full grid-cols-2 grid-rows-2">
        <span v-for="([x, y], i) in tiles" :key="i" class="relative block">
          <img
            :src="gbifBasemapTile(Z, x, y, 'dark')"
            alt=""
            loading="lazy"
            class="base-dark absolute inset-0 size-full"
          />
          <img
            :src="gbifBasemapTile(Z, x, y, 'light')"
            alt=""
            loading="lazy"
            class="base-light absolute inset-0 size-full"
          />
          <img
            :src="density[i]"
            alt=""
            data-density
            loading="lazy"
            class="absolute inset-0 size-full opacity-90"
            @error="onDensityError"
          />
        </span>
      </span>
      <span
        class="absolute bottom-2 right-2 rounded-sm bg-surface/90 px-2 py-1 text-xs text-text shadow-panel transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-contrast"
      >
        Explore on the map →
      </span>
    </a>
    <figcaption class="mt-1 text-xs text-subtle">Where {{ label }} has been recorded (all years).</figcaption>
  </figure>
</template>

<style>
/* Unscoped: Vue's :global() would discard the rest of the selector. */
[data-theme='light'] .mini-map .base-dark,
:root:not([data-theme='light']) .mini-map .base-light {
  display: none;
}
</style>
