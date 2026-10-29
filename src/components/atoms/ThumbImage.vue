<script setup lang="ts">
/**
 * GBIF thumbnail <img> with fade-in and request counting.
 * Server-rendered images are visible without JavaScript: the fade only
 * applies once mounted, and images that finished loading before hydration
 * are detected on mount.
 */
import { onBeforeUnmount, onMounted, ref, toRef } from 'vue';
import { useThumbnail } from '~/composables/useThumbnail';
import { GBIF_API_BASE, photoCrossOrigin, retryWithoutCors, type ThumbSize, type UsableImage } from '~/lib/gbif';

const props = withDefaults(defineProps<{ image: UsableImage; size?: ThumbSize; alt?: string }>(), {
  size: '400x',
  alt: '',
});
const emit = defineEmits<{ broken: []; loaded: [] }>();

const element = ref<HTMLImageElement>();
const mounted = ref(false);
/** Bumped to remount the <img> for a retry without crossorigin. */
const attempt = ref(0);
const { src, loaded, broken, onLoad, onError } = useThumbnail(toRef(props, 'image'), props.size);

/** GBIF's image cache sometimes fails on a miss and serves the photo moments later. */
const CACHE_RETRY_MS = 1500;
let cacheRetried = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function retryCacheMiss(url: string): boolean {
  if (cacheRetried || !url.startsWith(`${GBIF_API_BASE}/v1/image/cache/`)) return false;
  cacheRetried = true;
  retryTimer = setTimeout(() => attempt.value++, CACHE_RETRY_MS);
  return true;
}

function handleLoad() {
  onLoad();
  emit('loaded');
}

function handleError() {
  if (src.value && retryWithoutCors(src.value)) {
    attempt.value++;
    return;
  }
  if (src.value && retryCacheMiss(src.value)) return;
  onError();
  if (broken.value) emit('broken');
}

onMounted(() => {
  const image = element.value;
  if (image?.complete) {
    if (image.naturalWidth > 0) handleLoad();
    else handleError();
  }
  mounted.value = true;
});

onBeforeUnmount(() => clearTimeout(retryTimer));
</script>

<template>
  <img
    v-if="src && !broken"
    :key="attempt"
    ref="element"
    :src="src"
    :crossorigin="photoCrossOrigin(src)"
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
