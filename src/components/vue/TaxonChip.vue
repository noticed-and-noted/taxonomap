<script setup lang="ts">
/**
 * The active filters as removable chips: the selected taxa (the first few by
 * name, then a "+N more" chip), then one per other filter that is set.
 */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import { $filterPills, type FilterGroupId } from '~/stores/explorer';
import { $taxa, removeTaxon } from '~/stores/taxon';
import { FILTER_GROUPS } from './filterGroups';

const SHOWN = 3;
const taxa = useStore($taxa);
const pills = useStore($filterPills);
const iconOf = (group: FilterGroupId) => FILTER_GROUPS.find((g) => g.id === group)?.icon;
const shown = computed(() => taxa.value.slice(0, SHOWN));
const rest = computed(() => taxa.value.slice(SHOWN));
const nameOf = (t: { commonName?: string; scientificName: string }) => t.commonName ?? t.scientificName;
</script>

<template>
  <span
    v-if="taxa.length || pills.length"
    class="pills flex items-center gap-2"
    role="group"
    aria-label="Active filters"
  >
    <span v-for="t in shown" :key="t.key" class="chip max-w-[18rem]">
      <svg viewBox="0 0 24 24" class="chip-icon" aria-hidden="true"><path :d="iconOf('what')" /></svg>
      <span class="min-w-0 truncate">
        <span v-if="t.commonName" class="font-medium">{{ t.commonName }}</span>
        <span class="sci-name" :class="t.commonName ? 'ml-1 text-xs opacity-80' : ''">{{ t.scientificName }}</span>
      </span>
      <button type="button" class="chip-x" :aria-label="`Remove taxon filter ${nameOf(t)}`" @click="removeTaxon(t.key)">
        ×
      </button>
    </span>
    <span v-if="rest.length" class="chip more" :title="rest.map(nameOf).join(', ')">+{{ rest.length }} more</span>
    <span v-for="p in pills" :key="p.id" class="chip max-w-[18rem]" :title="p.text">
      <svg viewBox="0 0 24 24" class="chip-icon" aria-hidden="true"><path :d="iconOf(p.group)" /></svg>
      <span class="min-w-0 truncate">{{ p.text }}</span>
      <button type="button" class="chip-x" :aria-label="`Remove filter ${p.text}`" @click="p.clear()">×</button>
    </span>
  </span>
</template>

<style scoped>
/* One row (the filter rail sits just below it); scrolls sideways when full.
   The padding keeps the chips' shadows inside the scroll box. */
.pills {
  overflow-x: auto;
  scrollbar-width: none;
  margin: -0.25rem;
  padding: 0.25rem;
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

.chip-x:hover {
  background: var(--surface-3);
}
</style>
