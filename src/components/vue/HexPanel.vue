<script setup lang="ts">
/**
 * Selected cell summary: record count, a sortable and filterable species
 * table and radial seasonality.
 */
import { useStore } from '@nanostores/vue';
import { computed, onMounted, ref } from 'vue';
import { full } from '~/lib/format';
import { loadSpeciesManifest } from '~/lib/species/links';
import { $hexGeometry } from '~/stores/explorer';
import { $taxa } from '~/stores/taxon';
import HexRecords from './HexRecords.vue';
import RadialSeasonality from './RadialSeasonality.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesTable from './SpeciesTable.vue';
import { HEX_CLASSES, HEX_PER_CLASS, useHexSummary } from './useHexSummary';
import { perGroupNote } from './useLatestLoad';

const { loading, error, count, months, classes, species, reload } = useHexSummary();
const taxa = useStore($taxa);
const selectedKeys = computed(() => taxa.value.map((t) => t.key));
const tableNote = computed(() => perGroupNote(classes.value.length, HEX_CLASSES, HEX_PER_CLASS));
onMounted(() => void loadSpeciesManifest());
const geometry = useStore($hexGeometry);
const TABS = { species: 'Species', records: 'Records', months: 'By month' } as const;
const tab = ref<keyof typeof TABS>('species');
</script>

<template>
  <div v-if="!geometry" class="space-y-3" role="status" aria-label="Finding the selected cell">
    <SkeletonBlock height="2rem" width="50%" />
    <p class="text-xs text-subtle">Finding the selected cell on the map…</p>
  </div>

  <!-- Exactly the panel's height, so the active list fills what's left and scrolls on its own under
       the count and tabs. On a very short screen a list keeps its 12rem minimum and the panel scrolls. -->
  <div v-else class="hex-panel flex h-full flex-col gap-5">
    <div v-if="error" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
      {{
        error === 'unavailable'
          ? 'GBIF is busy right now, so this cell could not be summarised.'
          : 'This cell could not be summarised.'
      }}
      <button type="button" class="ml-1 text-text underline" @click="reload">Try again</button>
    </div>

    <template v-else>
      <section aria-live="polite">
        <SkeletonBlock v-if="loading && count === null" height="2rem" width="50%" />
        <template v-else-if="count !== null">
          <p class="font-display text-3xl leading-none tabular-nums">{{ full(count) }}</p>
          <p class="mt-1 text-sm text-muted">
            record{{ count === 1 ? '' : 's' }} in this cell<span v-if="taxa.length === 1">
              for <span v-if="taxa[0]?.commonName">{{ taxa[0].commonName }}</span
              ><span v-else class="sci-name">{{ taxa[0]?.scientificName }}</span></span
            ><span v-else-if="taxa.length"> for {{ taxa.length }} selected taxa</span>
          </p>
        </template>
      </section>

      <p v-if="!loading && count === 0" class="rounded-md bg-surface-2 p-3 text-sm text-muted">
        No records match the current filters here. Try widening the year range or removing a filter.
      </p>

      <section v-if="loading || count" class="flex min-h-0 flex-1 flex-col">
        <div role="tablist" aria-label="Cell lists" class="mb-2 flex gap-1 border-b border-border text-sm">
          <button
            v-for="(label, t) in TABS"
            :key="t"
            role="tab"
            type="button"
            :aria-selected="tab === t"
            class="-mb-px border-b-2 px-3 py-1.5"
            :class="tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
            @click="tab = t"
          >
            {{ label }}
          </button>
        </div>
        <div v-if="tab === 'species'" role="tabpanel" aria-label="Species" class="flex min-h-0 flex-1 flex-col">
          <SpeciesTable
            :rows="species"
            :groups="classes"
            :loading="loading"
            :selected="selectedKeys"
            :note="tableNote"
            fill
          />
        </div>
        <div v-else-if="tab === 'records'" role="tabpanel" aria-label="Records" class="flex min-h-0 flex-1 flex-col">
          <HexRecords :species="species" />
        </div>
        <div v-else role="tabpanel" aria-label="By month">
          <RadialSeasonality v-if="count" :counts="months" title="Records by month" />
        </div>
      </section>
    </template>
  </div>
</template>
