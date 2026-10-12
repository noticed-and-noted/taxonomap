<script setup lang="ts">
/**
 * /species/view?key= — renders any species in the browser with the same
 * components as the pre-rendered pages. If the species does have a static
 * page, it redirects there instead.
 */
import { onMounted, ref, shallowRef } from 'vue';
import { loadNameIndex } from '~/lib/data/name-index';
import { classifyError, type UiErrorKind } from '~/lib/gbif';
import { loadSpeciesData, type SpeciesData } from '~/lib/species/data';
import { loadSpeciesManifest, speciesPath, type SpeciesManifest } from '~/lib/species/links';
import MiniMap from './MiniMap.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesGallery from './SpeciesGallery.vue';
import SpeciesPage from './SpeciesPage.vue';

const data = shallowRef<SpeciesData | null>(null);
const manifest = shallowRef<SpeciesManifest | null>(null);
const error = ref<UiErrorKind | 'missing-key' | null>(null);
const key = ref<number | null>(null);

async function load() {
  error.value = null;
  const k = Number(new URLSearchParams(window.location.search).get('key'));
  if (!Number.isInteger(k) || k <= 0) {
    error.value = 'missing-key';
    return;
  }
  key.value = k;
  const m = await loadSpeciesManifest();
  manifest.value = m;
  if (m?.[String(k)]) {
    window.location.replace(speciesPath(k, m));
    return;
  }
  try {
    const idx = await loadNameIndex();
    data.value = await loadSpeciesData(k, (sk) => idx?.get(sk)?.[3] ?? null);
    const d = data.value;
    document.title = `${d.commonName ? `${d.commonName} (${d.canonicalName})` : d.canonicalName} · GBIF Explorer`;
  } catch (e) {
    error.value = classifyError(e);
  }
}

onMounted(load);
</script>

<template>
  <SpeciesPage v-if="data" :data="data" :manifest="manifest">
    <template v-if="data.images.length" #gallery>
      <SpeciesGallery :images="data.images" :name="data.commonName ?? data.canonicalName" />
    </template>
    <template v-if="data.count > 0" #map>
      <MiniMap :taxon-key="data.key" :label="data.commonName ?? data.canonicalName" />
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
    <p class="mt-6"><a href="/" class="text-accent underline-offset-2 hover:underline">Back to the map</a></p>
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
