<script setup lang="ts">
/**
 * GBIF thumbnail <img> with fade-in and request counting.
 * Server-rendered images are visible without JavaScript: the fade only
 * applies once mounted, and images that finished loading before hydration
 * are detected on mount.
 */
import { onMounted, ref, toRef } from 'vue';
import type { ThumbSize, UsableImage } from '~/lib/gbif';
import { useThumbnail } from './useThumbnail';

const props = withDefaults(defineProps<{ image: UsableImage; size?: ThumbSize; alt?: string }>(), {
  size: '400x',
  alt: '',
});
const emit = defineEmits<{ broken: []; loaded: [] }>();

const el = ref<HTMLImageElement>();
const mounted = ref(false);
const { src, loaded, broken, onLoad, onError } = useThumbnail(toRef(props, 'image'), props.size);

function handleLoad() {
  onLoad();
  emit('loaded');
}

function handleError() {
  onError();
  if (broken.value) emit('broken');
}

onMounted(() => {
  const img = el.value;
  if (img?.complete) {
    if (img.naturalWidth > 0) handleLoad();
    else handleError();
  }
  mounted.value = true;
});
</script>

<template>
  <img
    v-if="src && !broken"
    ref="el"
    :src="src"
    :alt="alt"
    loading="lazy"
    decoding="async"
    data-hide-on-error
    class="transition-opacity duration-300"
    :class="mounted && !loaded ? 'opacity-0' : 'opacity-100'"
    @load="handleLoad"
    @error="handleError"
  />
</template>
