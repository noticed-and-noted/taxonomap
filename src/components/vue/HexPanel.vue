<script setup lang="ts">
/**
 * Selected cell summary: record count, a sortable and filterable species
 * table, radial seasonality, and a switch to individual (clustered) records.
 */
import { useStore } from '@nanostores/vue';
import { computed, onMounted } from 'vue';
import { full } from '~/lib/format';
import { loadSpeciesManifest } from '~/lib/species/links';
import { $hexGeometry, $selectedRecord, $showRecords } from '~/stores/explorer';
import { $taxa } from '~/stores/taxon';
import RadialSeasonality from './RadialSeasonality.vue';
import RecordDetail from './RecordDetail.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesTable from './SpeciesTable.vue';
import { HEX_CLASSES, HEX_PER_CLASS, useHexSummary } from './useHexSummary';
import { perGroupNote } from './useLatestLoad';

const { loading, error, count, months, classes, species, reload } = useHexSummary();
const showRecords = useStore($showRecords);
const record = useStore($selectedRecord);
const taxa = useStore($taxa);
const selectedKeys = computed(() => taxa.value.map((t) => t.key));
const tableNote = computed(() => perGroupNote(classes.value.length, HEX_CLASSES, HEX_PER_CLASS));
onMounted(() => void loadSpeciesManifest());
const geometry = useStore($hexGeometry);

const toggleRecords = () => $showRecords.set(!showRecords.value);
const closeRecord = () => $selectedRecord.set(null);
</script>

<template>
  <RecordDetail v-if="record !== null" :occurrence-key="record" @back="closeRecord" />

  <div v-else-if="!geometry" class="space-y-3" role="status" aria-label="Finding the selected cell">
    <SkeletonBlock height="2rem" width="50%" />
    <p class="text-xs text-subtle">Finding the selected cell on the map…</p>
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

      <section v-if="loading || species.length" aria-labelledby="top-species-h">
        <h3 id="top-species-h" class="mb-2 text-sm font-medium">Species</h3>
        <SpeciesTable :rows="species" :groups="classes" :loading="loading" :selected="selectedKeys" :note="tableNote" />
      </section>

      <RadialSeasonality v-if="count" :counts="months" title="Records by month" />

      <section v-if="count">
        <button
          type="button"
          class="w-full rounded-md border border-border px-3 py-2 text-sm transition-colors duration-200 hover:border-accent"
          :aria-pressed="showRecords"
          @click="toggleRecords"
        >
          {{ showRecords ? 'Hide individual records' : 'Show individual records' }}
        </button>
        <p v-if="showRecords" class="mt-1.5 text-xs text-subtle">
          Showing up to 300 records as clustered points. Select a point to see the record and its source.
        </p>
      </section>
    </template>
  </div>
</template>
