<script setup lang="ts">
/**
 * Similar species cards (client island). The list comes from the page data;
 * each card's photo is that species' lead photo, looked up in the browser in
 * one batch, so it matches the first photo on the species' own page. The
 * iNaturalist taxa that lookup fetches carry common names too, so a species
 * the build named from GBIF takes iNaturalist's name at no extra cost.
 */
import { onMounted, ref, shallowRef } from 'vue';
import SpeciesCard from '~/components/molecules/SpeciesCard.vue';
import type { UsableImage } from '~/lib/gbif';
import { leadPhotos } from '~/lib/photos/taxon-photos';

export interface SimilarItem {
  key: number;
  scientificName: string;
  commonName?: string;
  count: number;
  href: string;
}

const props = defineProps<{ species: SimilarItem[] }>();

const images = shallowRef(new Map<number, UsableImage>());
const commonNames = shallowRef(new Map<number, string>());
const loading = ref(true);

onMounted(async () => {
  try {
    const photos = await leadPhotos(props.species.map((sibling) => ({ key: sibling.key, rank: 'SPECIES' as const })));
    images.value = photos.images;
    commonNames.value = photos.commonNames;
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
        :common-name="commonNames.get(sibling.key) ?? sibling.commonName ?? sibling.scientificName"
        :count="sibling.count"
        :image="images.get(sibling.key)"
        :loading="loading"
        size="400x"
        :href="sibling.href"
      />
    </li>
  </ul>
</template>
