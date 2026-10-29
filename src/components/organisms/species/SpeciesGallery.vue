<script setup lang="ts">
/**
 * Hero gallery (client island): the taxon's photos (see taxonPhotos), looked
 * up in the browser, with a skeleton until they arrive. A lead photo plus a
 * strip, each opening the photo lightbox (see PhotoLightbox).
 */
import { onMounted, ref, shallowRef } from 'vue';
import LicenceBadge from '~/components/atoms/LicenceBadge.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import PhotoLightbox from '~/components/molecules/PhotoLightbox.vue';
import type { Rank, UsableImage } from '~/lib/gbif';
import { taxonPhotos } from '~/lib/photos/taxon-photos';

const props = defineProps<{ taxonKey: number; rank: Rank; name: string }>();

const images = shallowRef<UsableImage[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    images.value = await taxonPhotos({ key: props.taxonKey, rank: props.rank });
  } catch {
    images.value = [];
  } finally {
    loading.value = false;
  }
});

const lightbox = ref<InstanceType<typeof PhotoLightbox>>();
const open = (imageIndex: number) => lightbox.value?.open(imageIndex);
</script>

<template>
  <div
    v-if="loading"
    class="grid gap-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    role="status"
    aria-label="Loading photos"
  >
    <SkeletonBlock class="aspect-[4/3]" height="auto" rounded="lg" aria-hidden="true" />
    <div class="grid grid-cols-4 content-start gap-1.5 sm:grid-cols-2">
      <SkeletonBlock v-for="slot in 4" :key="slot" class="aspect-square" height="auto" aria-hidden="true" />
    </div>
  </div>
  <!-- Square below sm and 2:1 above: the loading grid's footprint, so the page does not jump. -->
  <div
    v-else-if="!images.length"
    class="grid aspect-square place-items-center sm:aspect-[2/1] rounded-lg bg-photo text-sm text-subtle"
  >
    No openly licensed photos yet
  </div>
  <section v-else class="species-gallery" aria-label="Photos">
    <div class="grid gap-1.5 sm:grid-cols-[2fr_1fr]">
      <button
        type="button"
        class="relative block aspect-[4/3] cursor-pointer overflow-hidden rounded-lg bg-photo"
        :aria-label="`Enlarge photo 1 of ${images.length}`"
        @click="open(0)"
      >
        <ThumbImage :image="images[0]!" size="800x" :alt="name" class="size-full object-cover" />
        <span class="absolute bottom-2 left-2 right-2 text-left">
          <LicenceBadge
            :licence="images[0]!.licence"
            :creator="images[0]!.creator"
            :rights-holder="images[0]!.rightsHolder"
          />
        </span>
      </button>
      <div v-if="images.length > 1" class="grid grid-cols-4 content-start gap-1.5 sm:grid-cols-2">
        <button
          v-for="(image, position) in images.slice(1, 5)"
          :key="image.url"
          type="button"
          class="relative block aspect-square cursor-pointer overflow-hidden rounded-md bg-photo"
          :aria-label="`Enlarge photo ${position + 2} of ${images.length}`"
          @click="open(position + 1)"
        >
          <ThumbImage :image="image" size="200x" :alt="''" class="size-full object-cover" />
          <span
            v-if="position === 3 && images.length > 5"
            class="absolute inset-0 grid place-items-center bg-black/50 text-sm text-white"
          >
            +{{ images.length - 5 }}
          </span>
        </button>
      </div>
    </div>

    <PhotoLightbox ref="lightbox" :images="images" :name="name" />
  </section>
</template>
