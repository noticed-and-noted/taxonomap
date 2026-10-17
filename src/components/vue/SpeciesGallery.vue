<script setup lang="ts">
/**
 * Hero gallery (client island): the taxon's photos (see taxonPhotos), looked
 * up in the browser, with a skeleton until they arrive. A lead photo plus a
 * strip; opens a <dialog> lightbox with keyboard navigation. Every photo
 * shows its licence and creator, and links to where it came from. The
 * lightbox swaps photos immediately, showing a skeleton until the new one
 * loads, and preloads its neighbours so stepping through is usually instant.
 */
import { computed, onMounted, reactive, ref, shallowRef } from 'vue';
import { countRequest, photoCrossOrigin, thumbnailUrl, type Rank, type UsableImage } from '~/lib/gbif';
import { taxonPhotos } from '~/lib/photos/taxon-photos';
import LicenceBadge from './LicenceBadge.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';

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

/** Where a photo came from: its GBIF record, or its iNaturalist observation (or photo page). */
function sourceOf(img: UsableImage): { href: string; label: string } {
  if (img.source === 'inat') {
    return {
      href: img.observationUrl ?? `https://www.inaturalist.org/photos/${img.photoId}`,
      label: img.observationUrl ? 'Observation' : 'Photo',
    };
  }
  return { href: `https://www.gbif.org/occurrence/${img.occurrenceKey}`, label: 'Source record' };
}

const dialog = ref<HTMLDialogElement>();
const index = ref(0);
/** The lightbox renders its photo only while open, so none is fetched (or server-rendered) up front. */
const isOpen = ref(false);
const current = computed(() => images.value[index.value]);
const currentSrc = computed(() => (current.value ? thumbnailUrl(current.value, '800x') : undefined));

/** Lightbox URLs that have finished loading (or failed), so their skeletons can go. */
const settled = reactive(new Set<string>());
const failed = reactive(new Set<string>());
const preloading = new Set<string>();

function settle(url: string, ok: boolean) {
  if (settled.has(url)) return;
  countRequest('image');
  settled.add(url);
  if (!ok) failed.add(url);
}

function preload(i: number) {
  const img = images.value[i];
  if (!img) return;
  const url = thumbnailUrl(img, '800x');
  if (settled.has(url) || preloading.has(url)) return;
  preloading.add(url);
  const el = new Image();
  el.decoding = 'async';
  // Same mode as the <img> below, so the preloaded copy is the one it uses.
  const cors = photoCrossOrigin(url);
  if (cors) el.crossOrigin = cors;
  el.onload = () => settle(url, true);
  el.onerror = () => settle(url, false);
  el.src = url;
}

function preloadAround(i: number) {
  const n = images.value.length;
  preload((i + 1) % n);
  preload((i - 1 + n) % n);
}

function open(i: number) {
  index.value = i;
  isOpen.value = true;
  dialog.value?.showModal();
  preloadAround(i);
}

function step(d: number) {
  const n = images.value.length;
  index.value = (index.value + d + n) % n;
  preloadAround(index.value);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
}

function onBackdrop(e: MouseEvent) {
  if (e.target === dialog.value) dialog.value?.close();
}
</script>

<template>
  <div v-if="loading" class="grid gap-1.5 sm:grid-cols-[2fr_1fr]" role="status" aria-label="Loading photos">
    <SkeletonBlock class="aspect-[4/3]" height="auto" rounded="lg" aria-hidden="true" />
    <div class="grid grid-cols-4 content-start gap-1.5 sm:grid-cols-2">
      <SkeletonBlock v-for="i in 4" :key="i" class="aspect-square" height="auto" aria-hidden="true" />
    </div>
  </div>
  <div v-else-if="!images.length" class="grid aspect-[4/3] place-items-center rounded-lg bg-photo text-sm text-subtle">
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
          v-for="(img, i) in images.slice(1, 5)"
          :key="img.url"
          type="button"
          class="relative block aspect-square cursor-pointer overflow-hidden rounded-md bg-photo"
          :aria-label="`Enlarge photo ${i + 2} of ${images.length}`"
          @click="open(i + 1)"
        >
          <ThumbImage :image="img" size="200x" :alt="''" class="size-full object-cover" />
          <span
            v-if="i === 3 && images.length > 5"
            class="absolute inset-0 grid place-items-center bg-black/50 text-sm text-white"
          >
            +{{ images.length - 5 }}
          </span>
        </button>
      </div>
    </div>

    <dialog
      ref="dialog"
      class="lightbox m-auto max-h-[92dvh] w-[min(64rem,94vw)] rounded-lg border border-border bg-surface p-0 text-text shadow-panel backdrop:bg-black/80"
      :aria-label="`${name} photos`"
      @keydown="onKey"
      @click="onBackdrop"
      @close="isOpen = false"
    >
      <div v-if="current && isOpen" class="flex max-h-[92dvh] flex-col">
        <div class="relative h-[min(75dvh,48rem)] shrink-0 bg-surface-2">
          <SkeletonBlock
            v-if="currentSrc && !settled.has(currentSrc)"
            class="absolute inset-0"
            width="100%"
            height="100%"
            rounded="sm"
            label="Loading photo"
          />
          <p
            v-else-if="currentSrc && failed.has(currentSrc)"
            class="absolute inset-0 grid place-items-center text-sm text-muted"
          >
            Couldn't load this photo
          </p>
          <img
            v-if="currentSrc && !failed.has(currentSrc)"
            :key="currentSrc"
            :src="currentSrc"
            :crossorigin="photoCrossOrigin(currentSrc)"
            :alt="name"
            decoding="async"
            class="relative size-full object-contain transition-opacity duration-200"
            :class="settled.has(currentSrc) ? 'opacity-100' : 'opacity-0'"
            @load="settle(currentSrc, true)"
            @error="settle(currentSrc, false)"
          />
          <button type="button" class="nav left-2" aria-label="Previous photo" @click="step(-1)">‹</button>
          <button type="button" class="nav right-2" aria-label="Next photo" @click="step(1)">›</button>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span class="flex flex-wrap items-center gap-2">
            <LicenceBadge :licence="current.licence" :creator="current.creator" :rights-holder="current.rightsHolder" />
            <span v-if="current.publisher" class="text-xs text-muted">via {{ current.publisher }}</span>
            <a
              :href="sourceOf(current).href"
              target="_blank"
              rel="noopener"
              class="text-xs text-accent underline-offset-2 hover:underline"
            >
              {{ sourceOf(current).label }} ↗
            </a>
          </span>
          <span class="flex items-center gap-3 text-xs text-muted">
            {{ index + 1 }} / {{ images.length }}
            <form method="dialog">
              <button class="rounded-md border border-border px-2 py-1 hover:border-accent">Close</button>
            </form>
          </span>
        </div>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.nav {
  position: absolute;
  top: 50%;
  translate: 0 -50%;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.55);
  color: white;
  font-size: 1.5rem;
  line-height: 1;
}
.nav:hover {
  background: rgb(0 0 0 / 0.8);
}
.lightbox[open] {
  animation: pop var(--dur) var(--ease);
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .lightbox[open] {
    animation: none;
  }
}
</style>
