<script setup lang="ts">
/**
 * The active filters as removable chips: the selected taxa (the first few by
 * name, then a "+N more" chip), then one per other filter that is set.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import { $filterPills, type FilterGroupId } from '~/stores/explorer';
import { $taxa, removeTaxon } from '~/stores/taxon';
import { FILTER_GROUPS } from './filterGroups';
import { useDragScroll } from './useDragScroll';
import { useScrollFade } from './useScrollFade';

const SHOWN = 3;
const taxa = useStore($taxa);
const pills = useStore($filterPills);
const manifest = useStore($speciesManifest);
const iconOf = (group: FilterGroupId) => FILTER_GROUPS.find((filterGroup) => filterGroup.id === group)?.icon;
const shown = computed(() => taxa.value.slice(0, SHOWN));
const rest = computed(() => taxa.value.slice(SHOWN));
const nameOf = (taxon: { commonName?: string; scientificName: string }) => taxon.commonName ?? taxon.scientificName;

// Fade whichever side has more chips beyond it.
const row = ref<HTMLElement>();
const { fadeLeft, fadeRight, update } = useScrollFade(row);
const { onPointerDown, onClickCapture } = useDragScroll(row);
const resize = new ResizeObserver(update);
watch(row, (element, previous) => {
  if (previous) resize.unobserve(previous);
  if (element) resize.observe(element);
});
watch([taxa, pills], () => nextTick(update));
onBeforeUnmount(() => resize.disconnect());
</script>

<template>
  <span
    v-if="taxa.length || pills.length"
    ref="row"
    class="pills flex items-center gap-2"
    :class="{ 'fade-left': fadeLeft, 'fade-right': fadeRight }"
    role="group"
    aria-label="Active filters"
    @scroll.passive="update"
    @pointerdown="onPointerDown"
    @click.capture="onClickCapture"
  >
    <span v-for="taxon in shown" :key="taxon.key" class="chip max-w-[18rem]">
      <svg viewBox="0 0 24 24" class="chip-icon" aria-hidden="true"><path :d="iconOf('what')" /></svg>
      <a
        :href="speciesPath(taxon.key, manifest)"
        class="chip-link min-w-0 truncate"
        :class="{ 'sci-name': !taxon.commonName, 'font-medium': taxon.commonName }"
        :title="`About ${nameOf(taxon)}`"
        >{{ nameOf(taxon) }}</a
      >
      <button
        type="button"
        class="chip-x"
        :aria-label="`Remove taxon filter ${nameOf(taxon)}`"
        @click="removeTaxon(taxon.key)"
      >
        ×
      </button>
    </span>
    <span v-if="rest.length" class="chip more" :title="rest.map(nameOf).join(', ')">+{{ rest.length }} more</span>
    <span v-for="pill in pills" :key="pill.id" class="chip max-w-[18rem]" :title="pill.text">
      <svg viewBox="0 0 24 24" class="chip-icon" aria-hidden="true"><path :d="iconOf(pill.group)" /></svg>
      <span class="min-w-0 truncate">{{ pill.text }}</span>
      <button type="button" class="chip-x" :aria-label="`Remove filter ${pill.text}`" @click="pill.clear()">×</button>
    </span>
  </span>
</template>

<style scoped>
/* One row (the filter rail sits just below it); scrolls sideways when full.
   The padding fits --shadow (8px down, 28px blur) inside the scroll box, which clips it;
   the box ignores the pointer so that padding doesn't block the map.
   The side fades start at the chips' edge, hiding chips scrolled into the shadow padding. */
.pills {
  --pad-left: 1.75rem;
  --pad-right: 1.75rem;
  --fade: 1.5rem;
  --left-start: 0px;
  --left-end: 0px;
  --right-start: 0px;
  --right-end: 0px;
  overflow: auto hidden;
  scrollbar-width: none;
  user-select: none; /* a drag scrolls rather than selecting chip text */
  margin: -1.25rem calc(-1 * var(--pad-right)) -2.25rem calc(-1 * var(--pad-left));
  padding: 1.25rem var(--pad-right) 2.25rem var(--pad-left);
  pointer-events: none;
  mask-image: linear-gradient(
    to right,
    transparent var(--left-start),
    #000 var(--left-end),
    #000 calc(100% - var(--right-end)),
    transparent calc(100% - var(--right-start))
  );
}
.pills.fade-left {
  --left-start: var(--pad-left);
  --left-end: calc(var(--pad-left) + var(--fade));
}
.pills.fade-right {
  --right-start: var(--pad-right);
  --right-end: calc(var(--pad-right) + var(--fade));
}

/* Phone: end the scroll box at the Near me button, with the right padding inside it so the
   last chip's shadow tails off softly instead of clipping. It takes touches, since WebKit
   won't touch-scroll a pointer-events: none box. */
@media (max-width: 639.98px) {
  .pills {
    --pad-right: 0.5rem; /* matches the Near me button's gap to Filters */
    --right-end: var(--pad-right);
    margin-right: 0;
    pointer-events: auto;
  }
}

.chip {
  pointer-events: auto;
}

.chip {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  color: var(--text);
  font-size: 0.8125rem;
  white-space: nowrap;
  box-shadow: var(--shadow);
}

.chip-icon {
  flex-shrink: 0;
  width: 0.875rem;
  height: 0.875rem;
  margin-left: -0.25rem;
  color: var(--text-muted);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chip.more {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text-muted);
}

.chip-x {
  display: grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  margin-right: -0.375rem;
  border-radius: 50%;
  font-size: 1rem;
  line-height: 1;
}

.chip-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chip-x:hover {
  background: var(--surface-3);
}
</style>
