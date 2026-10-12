<script setup lang="ts">
/** GBIF thumbnail <img> with fade-in, edge fallback and request counting. */
import { toRef } from 'vue';
import type { ThumbSize, UsableImage } from '~/lib/gbif';
import { useThumbnail } from './useThumbnail';

const props = withDefaults(defineProps<{ image: UsableImage; size?: ThumbSize; alt?: string }>(), {
  size: '400x',
  alt: '',
});
const emit = defineEmits<{ broken: [] }>();

const { src, loaded, broken, onLoad, onError } = useThumbnail(toRef(props, 'image'), props.size);

function handleError() {
  onError();
  if (broken.value) emit('broken');
}
</script>

<template>
  <img
    v-if="src && !broken"
    :src="src"
    :alt="alt"
    loading="lazy"
    decoding="async"
    class="transition-opacity duration-300"
    :class="loaded ? 'opacity-100' : 'opacity-0'"
    @load="onLoad"
    @error="handleError"
  />
</template>
