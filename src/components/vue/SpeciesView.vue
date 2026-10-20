<script setup lang="ts">
/**
 * /species/view/{key} — renders any taxon (species or group) in the browser
 * with the same components as the pre-rendered pages. If it does have a
 * static page, it redirects there instead; if GBIF cannot give us the taxon
 * at all, it falls back to the tree of life, focused on that key. Transient
 * failures keep the retry, with the tree offered as an alternative.
 */
import { onMounted, ref, shallowRef } from 'vue';
import { loadNameIndex } from '~/lib/data/name-index';
import { classifyError, type UiErrorKind } from '~/lib/gbif';
import { loadSpeciesData, type SpeciesData } from '~/lib/species/data';
import { loadSpeciesManifest, similarItems, speciesPath, type SpeciesManifest } from '~/lib/species/links';
import { speciesCharts } from '~/lib/species/charts';
import MiniMap from './MiniMap.vue';
import PlotChart from './PlotChart.vue';
import SimilarSpecies from './SimilarSpecies.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesGallery from './SpeciesGallery.vue';
import SpeciesPage from './SpeciesPage.vue';

const data = shallowRef<SpeciesData | null>(null);
const manifest = shallowRef<SpeciesManifest | null>(null);
const error = ref<UiErrorKind | 'missing-key' | null>(null);
const key = ref<number | null>(null);

async function load() {
  error.value = null;
  const speciesKey = Number(window.location.pathname.split('/')[3]);
  if (!Number.isInteger(speciesKey) || speciesKey <= 0) {
    error.value = 'missing-key';
    return;
  }
  key.value = speciesKey;
  const loadedManifest = await loadSpeciesManifest();
  manifest.value = loadedManifest;
  if (loadedManifest?.[String(speciesKey)]) {
    window.location.replace(speciesPath(speciesKey, loadedManifest));
    return;
  }
  try {
    const nameIndex = await loadNameIndex();
    data.value = await loadSpeciesData(speciesKey, (taxonKey) => nameIndex?.get(taxonKey)?.commonName ?? null);
    const loaded = data.value;
    document.title = `${loaded.commonName ? `${loaded.commonName} (${loaded.canonicalName})` : loaded.canonicalName} · Taxonomap`;
  } catch (failure) {
    const kind = classifyError(failure);
    if (kind === 'not-found' || kind === 'bad-request') {
      window.location.replace(treeHref(speciesKey));
      return;
    }
    error.value = kind;
  }
}

const treeHref = (taxonKey: number) => `/tree?focus=${taxonKey}`;

onMounted(load);
</script>

<template>
  <SpeciesPage v-if="data" :data="data">
    <template #gallery>
      <SpeciesGallery :taxon-key="data.key" :rank="data.rank" :name="data.commonName ?? data.canonicalName" />
    </template>
    <template v-if="data.siblings.length" #similar>
      <SimilarSpecies :species="similarItems(data.siblings, manifest)" />
    </template>
    <template v-if="data.count > 0" #map>
      <MiniMap :taxon-key="data.key" :label="data.commonName ?? data.canonicalName" />
    </template>
    <template #years>
      <PlotChart kind="years" title="Records per year" :years="data.years" />
    </template>
    <template #countries>
      <PlotChart kind="bars" title="Top countries" :bars="speciesCharts(data).countries" :total="data.count" />
    </template>
    <template #datasets>
      <PlotChart
        kind="bars"
        title="Top datasets"
        caption="publishers of the records"
        :bars="speciesCharts(data).datasets"
        :total="data.count"
      />
    </template>
  </SpeciesPage>

  <div v-else-if="error" class="mx-auto max-w-xl px-4 py-16 text-center" role="alert">
    <h1 class="font-display text-3xl">
      {{ error === 'not-found' || error === 'missing-key' ? 'Species not found' : 'Could not load this species' }}
    </h1>
    <p class="mt-3 text-muted">
      <template v-if="error === 'missing-key'">This link is missing a species key.</template>
      <template v-else-if="error === 'not-found'">GBIF has no taxon with key {{ key }}.</template>
      <template v-else>GBIF is busy right now. Please try again in a moment.</template>
    </p>
    <button
      v-if="error === 'unavailable' || error === 'unknown'"
      type="button"
      class="mt-5 rounded-md bg-accent px-4 py-2 text-accent-contrast"
      @click="load"
    >
      Try again
    </button>
    <p class="mt-6 flex justify-center gap-6">
      <a v-if="key !== null" :href="treeHref(key)" class="text-accent underline-offset-2 hover:underline"
        >Open in the tree of life</a
      >
      <a href="/" class="text-accent underline-offset-2 hover:underline">Back to the map</a>
    </p>
  </div>

  <div v-else class="mx-auto max-w-6xl space-y-4 px-4 pt-6 sm:px-6" role="status" aria-label="Loading species">
    <SkeletonBlock width="40%" height="0.8rem" />
    <SkeletonBlock width="60%" height="3rem" />
    <SkeletonBlock width="30%" height="1.2rem" />
    <div class="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <SkeletonBlock height="22rem" rounded="lg" />
      <SkeletonBlock height="22rem" rounded="lg" />
    </div>
  </div>
</template>
