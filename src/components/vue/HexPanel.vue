<script setup lang="ts">
/**
 * Selected cell summary: record count, top 10 species as photo cards,
 * radial seasonality, and a switch to individual (clustered) records.
 */
import { useStore } from '@nanostores/vue';
import { onMounted } from 'vue';
import { full } from '~/lib/format';
import { $speciesManifest, loadSpeciesManifest, speciesPath } from '~/lib/species/links';
import { $hexGeometry, $selectedRecord, $showRecords } from '~/stores/explorer';
import { $taxonInfo } from '~/stores/taxon';
import RadialSeasonality from './RadialSeasonality.vue';
import RecordDetail from './RecordDetail.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesCard from './SpeciesCard.vue';
import { useHexSummary } from './useHexSummary';

const { loading, error, count, months, species, reload } = useHexSummary();
const showRecords = useStore($showRecords);
const record = useStore($selectedRecord);
const taxon = useStore($taxonInfo);
const manifest = useStore($speciesManifest);
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
            record{{ count === 1 ? '' : 's' }} in this cell<span v-if="taxon">
              for <span v-if="taxon.commonName">{{ taxon.commonName }}</span
              ><span v-else class="sci-name">{{ taxon.scientificName }}</span></span
            >
          </p>
        </template>
      </section>

      <p v-if="!loading && count === 0" class="rounded-md bg-surface-2 p-3 text-sm text-muted">
        No records match the current filters here. Try widening the year range or removing a filter.
      </p>

      <section v-if="loading || species.length" aria-labelledby="top-species-h">
        <h3 id="top-species-h" class="mb-2 text-sm font-medium">
          {{ species.length === 1 ? 'Species' : 'Most-recorded species' }}
        </h3>
        <div v-if="loading && !species.length" class="grid grid-cols-2 gap-2">
          <SkeletonBlock v-for="i in 4" :key="i" height="9rem" />
        </div>
        <ul v-else class="grid grid-cols-2 gap-2">
          <li v-for="s in species" :key="s.key">
            <SpeciesCard
              :species-key="s.key"
              :scientific-name="s.scientificName"
              :common-name="s.commonName"
              :count="s.count"
              :image="s.image"
              :selected="taxon?.key === s.key"
              :href="speciesPath(s.key, manifest)"
              size="200x"
            />
          </li>
        </ul>
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
