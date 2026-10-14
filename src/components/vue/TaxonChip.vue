<script setup lang="ts">
/**
 * The selected taxa (the What filter) as removable chips: the first few by
 * name, then a "+N more" chip. Other filters live in the filter rail / sheet.
 */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import { $taxa, removeTaxon } from '~/stores/taxon';

const SHOWN = 3;
const taxa = useStore($taxa);
const shown = computed(() => taxa.value.slice(0, SHOWN));
const rest = computed(() => taxa.value.slice(SHOWN));
const nameOf = (t: { commonName?: string; scientificName: string }) => t.commonName ?? t.scientificName;
</script>

<template>
  <span v-if="taxa.length" class="flex flex-wrap items-center gap-2" role="group" aria-label="Selected taxa">
    <span v-for="t in shown" :key="t.key" class="chip max-w-[18rem]">
      <span class="min-w-0 truncate">
        <span v-if="t.commonName" class="font-medium">{{ t.commonName }}</span>
        <span class="sci-name" :class="t.commonName ? 'ml-1 text-xs opacity-80' : ''">{{ t.scientificName }}</span>
      </span>
      <button type="button" class="chip-x" :aria-label="`Remove taxon filter ${nameOf(t)}`" @click="removeTaxon(t.key)">
        ×
      </button>
    </span>
    <span v-if="rest.length" class="chip more" :title="rest.map(nameOf).join(', ')">+{{ rest.length }} more</span>
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
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
