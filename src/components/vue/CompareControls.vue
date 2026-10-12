<script setup lang="ts">
/**
 * Compare mode: two species overlaid in contrasting (Okabe–Ito) colours, or a
 * swipe between two year ranges. Also acts as the legend while comparing.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref, watch } from 'vue';
import { nameIndexWithin } from '~/lib/data/name-index';
import { getSpecies, type NameHit } from '~/lib/gbif';
import { $compareMode, $panel, $taxonB, $yearRange, $yearRangeB } from '~/stores/explorer';
import { $taxonInfo } from '~/stores/taxon';
import TaxonPicker from './TaxonPicker.vue';

const mode = useStore($compareMode);
const taxonA = useStore($taxonInfo);
const taxonBKey = useStore($taxonB);
const yearsA = useStore($yearRange);
const yearsB = useStore($yearRangeB);
const nameB = ref<string | null>(null);
const NOW = new Date().getFullYear();

watch(
  taxonBKey,
  async (k) => {
    nameB.value = null;
    if (k === null) return;
    const idx = await nameIndexWithin();
    const row = idx?.get(k);
    nameB.value = row
      ? (row[3] ?? row[2])
      : await getSpecies(k)
          .then((u) => u.canonicalName ?? u.scientificName)
          .catch(() => `Taxon ${k}`);
  },
  { immediate: true },
);

const bFrom = computed(() => yearsB.value?.[0] ?? 2000);
const bTo = computed(() => yearsB.value?.[1] ?? NOW);
const labelA = computed(() => (yearsA.value ? `${yearsA.value[0]}–${yearsA.value[1]}` : 'All years'));

function setMode(m: 'species' | 'years') {
  $compareMode.set(m);
  if (m === 'years' && !yearsB.value) $yearRangeB.set([2000, NOW]);
  if (m === 'years' && !yearsA.value) $yearRange.set([1900, 1999]);
}

function close() {
  $compareMode.set('off');
  if ($panel.get() === 'compare') $panel.set('none');
}

const clearB = () => $taxonB.set(null);

function pickB(h: NameHit) {
  $taxonB.set(h.key);
  nameB.value = h.commonName ?? h.scientificName;
}

function setB(which: 0 | 1, e: Event) {
  const v = Math.max(1700, Math.min(NOW, Number((e.target as HTMLInputElement).value) || 0));
  const next: [number, number] = which === 0 ? [v, bTo.value] : [bFrom.value, v];
  $yearRangeB.set([Math.min(...next), Math.max(...next)]);
}
</script>

<template>
  <section
    class="w-72 rounded-lg border border-border bg-surface/95 p-3 text-sm shadow-panel backdrop-blur"
    aria-labelledby="cmp-h"
  >
    <div class="mb-2 flex items-center justify-between">
      <h2 id="cmp-h" class="font-display text-base">Compare</h2>
      <button
        type="button"
        class="rounded px-1.5 text-muted hover:bg-surface-2"
        aria-label="Close compare"
        @click="close"
      >
        ✕
      </button>
    </div>
    <div class="mb-3 flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Compare what">
      <button
        type="button"
        class="flex-1 rounded-sm px-2 py-1"
        :class="mode === 'species' ? 'bg-accent text-accent-contrast' : 'text-muted'"
        :aria-pressed="mode === 'species'"
        @click="setMode('species')"
      >
        Two species
      </button>
      <button
        type="button"
        class="flex-1 rounded-sm px-2 py-1"
        :class="mode === 'years' ? 'bg-accent text-accent-contrast' : 'text-muted'"
        :aria-pressed="mode === 'years'"
        @click="setMode('years')"
      >
        Two time ranges
      </button>
    </div>

    <template v-if="mode === 'species'">
      <p class="flex items-center gap-2">
        <span class="size-3 shrink-0 rounded-sm bg-[var(--compare-a)]" aria-hidden="true"></span>
        <span v-if="taxonA" class="truncate">{{ taxonA.commonName ?? taxonA.scientificName }}</span>
        <span v-else class="text-muted">Pick a species in the main search</span>
      </p>
      <div class="mt-2 flex items-center gap-2">
        <span class="size-3 shrink-0 rounded-sm bg-[var(--compare-b)]" aria-hidden="true"></span>
        <span v-if="nameB" class="truncate">{{ nameB }}</span>
        <button v-if="taxonBKey !== null" type="button" class="ml-auto text-xs text-muted underline" @click="clearB">
          change
        </button>
      </div>
      <TaxonPicker v-if="taxonBKey === null" class="mt-1" label="Second species…" @pick="pickB" />
      <p class="mt-2 text-xs text-subtle">Stronger colour = more records. Where both occur, colours mix.</p>
    </template>

    <template v-else-if="mode === 'years'">
      <p class="text-xs text-muted">
        Left of the handle: <span class="text-text">{{ labelA }}</span> (time slider)
      </p>
      <fieldset class="mt-2">
        <legend class="text-xs text-muted">Right of the handle</legend>
        <div class="mt-1 flex items-center gap-2">
          <input
            type="number"
            min="1700"
            :max="NOW"
            :value="bFrom"
            aria-label="Right side from year"
            class="h-8 w-24 rounded-md border border-border bg-bg px-2"
            @change="setB(0, $event)"
          />
          <span class="text-muted">to</span>
          <input
            type="number"
            min="1700"
            :max="NOW"
            :value="bTo"
            aria-label="Right side to year"
            class="h-8 w-24 rounded-md border border-border bg-bg px-2"
            @change="setB(1, $event)"
          />
        </div>
      </fieldset>
      <p class="mt-2 text-xs text-subtle">Drag the ⇆ handle (or focus it and use the arrow keys) to swipe.</p>
    </template>

    <p v-else class="text-xs text-muted">Choose what to compare.</p>
  </section>
</template>
