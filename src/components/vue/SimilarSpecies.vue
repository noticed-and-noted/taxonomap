<script setup lang="ts">
/**
 * Similar species cards (client island). The list comes from the page data;
 * each card's photo is that species' lead photo, looked up in the browser in
 * one batch, so it matches the first photo on the species' own page.
 */
import { onMounted, ref, shallowRef } from 'vue';
import type { UsableImage } from '~/lib/gbif';
import { leadPhotos } from '~/lib/photos/taxon-photos';
import SpeciesCard from './SpeciesCard.vue';

export interface SimilarItem {
  key: number;
  scientificName: string;
  commonName?: string;
  count: number;
  href: string;
}

const props = defineProps<{ species: SimilarItem[] }>();

const images = shallowRef(new Map<number, UsableImage>());
const loading = ref(true);

onMounted(async () => {
  try {
    const r = await leadPhotos(props.species.map((s) => ({ key: s.key, rank: 'SPECIES' as const })));
    images.value = r.images;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    <li v-for="s in species" :key="s.key">
      <SpeciesCard
        :species-key="s.key"
        :scientific-name="s.scientificName"
        :common-name="s.commonName ?? s.scientificName"
        :count="s.count"
        :image="images.get(s.key)"
        :loading="loading"
        size="400x"
        :href="s.href"
      />
    </li>
  </ul>
</template>
