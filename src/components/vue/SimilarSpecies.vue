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
    const photos = await leadPhotos(props.species.map((sibling) => ({ key: sibling.key, rank: 'SPECIES' as const })));
    images.value = photos.images;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    <li v-for="sibling in species" :key="sibling.key">
      <SpeciesCard
        :species-key="sibling.key"
        :scientific-name="sibling.scientificName"
        :common-name="sibling.commonName ?? sibling.scientificName"
        :count="sibling.count"
        :image="images.get(sibling.key)"
        :loading="loading"
        size="400x"
        :href="sibling.href"
      />
    </li>
  </ul>
</template>
