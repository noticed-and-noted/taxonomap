<script setup lang="ts">
/**
 * Selected cell summary: record count, a sortable species table that can be
 * narrowed to one group, and radial seasonality.
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
import { HEX_SPECIES, useHexSummary } from './useHexSummary';

const { loading, error, count, months, classes, species, cellSpecies, group, pickGroup, reload } = useHexSummary();
const taxa = useStore($taxa);
const selectedKeys = computed(() => taxa.value.map((taxon) => taxon.key));
const tableNote = computed(() =>
  species.value.length >= HEX_SPECIES ? `the ${HEX_SPECIES} most recorded` : undefined,
);
onMounted(() => void loadSpeciesManifest());
const geometry = useStore($hexGeometry);
const tab = ref<'species' | 'records'>('species');
</script>

<template>
  <div v-if="!geometry" role="status" aria-label="Finding the selected cell">
    <SkeletonBlock height="1.875rem" width="50%" />
    <p class="mt-1 text-sm text-subtle">Finding the selected cell on the map…</p>
  </div>

  <div v-else class="hex-panel space-y-5">
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
        <!-- The count's size: a text-3xl number over a text-sm line. -->
        <div v-if="loading && count === null">
          <SkeletonBlock height="1.875rem" width="50%" label="Loading record count" />
          <div class="mt-1 flex h-5 items-center" aria-hidden="true">
            <SkeletonBlock height="0.75rem" width="8rem" />
          </div>
        </div>
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

      <section v-if="loading || count">
        <div role="tablist" aria-label="Cell lists" class="mb-2 flex gap-1 border-b border-border text-sm">
          <button
            v-for="mode in ['species', 'records'] as const"
            :key="mode"
            role="tab"
            type="button"
            :aria-selected="tab === mode"
            class="-mb-px border-b-2 px-3 py-1.5"
            :class="tab === mode ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
            @click="tab = mode"
          >
            {{ mode === 'species' ? 'Species' : 'Records' }}
          </button>
        </div>
        <div v-if="tab === 'species'" role="tabpanel" aria-label="Species">
          <SpeciesTable
            :rows="species"
            :groups="classes"
            :loading="loading"
            :selected="selectedKeys"
            :note="tableNote"
            :group="group"
            @update:group="pickGroup"
          />
        </div>
        <div v-else role="tabpanel" aria-label="Records">
          <HexRecords :species="cellSpecies" />
        </div>
      </section>

      <RadialSeasonality v-if="count" :counts="months" title="Records by month" />
    </template>
  </div>
</template>
