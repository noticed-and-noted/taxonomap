<script setup lang="ts">
/**
 * Hero gallery (client:visible): a lead photo plus a strip; opens a
 * <dialog> lightbox with keyboard navigation. Every photo shows its licence
 * and creator, and links to the source record. The first photo renders on
 * the server, so the page has an image before hydration.
 */
import { computed, ref } from 'vue';
import { thumbnailUrl, type UsableImage } from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import ThumbImage from './ThumbImage.vue';

const props = defineProps<{ images: readonly UsableImage[]; name: string }>();

const dialog = ref<HTMLDialogElement>();
const index = ref(0);
const current = computed(() => props.images[index.value]);

function open(i: number) {
  index.value = i;
  dialog.value?.showModal();
}

function step(d: number) {
  const n = props.images.length;
  index.value = (index.value + d + n) % n;
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
  <section v-if="images.length" class="species-gallery" aria-label="Photos">
    <div class="grid gap-1.5 sm:grid-cols-[2fr_1fr]">
      <button
        type="button"
        class="relative block aspect-[4/3] overflow-hidden rounded-lg bg-photo"
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
      <div v-if="images.length > 1" class="grid grid-cols-4 gap-1.5 sm:grid-cols-2">
        <button
          v-for="(img, i) in images.slice(1, 5)"
          :key="img.url"
          type="button"
          class="relative block aspect-square overflow-hidden rounded-md bg-photo"
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
    >
      <div v-if="current" class="flex max-h-[92dvh] flex-col">
        <div class="relative min-h-0 flex-1 bg-black">
          <img :src="thumbnailUrl(current, '800x')" :alt="name" class="mx-auto max-h-[75dvh] w-auto object-contain" />
          <button type="button" class="nav left-2" aria-label="Previous photo" @click="step(-1)">‹</button>
          <button type="button" class="nav right-2" aria-label="Next photo" @click="step(1)">›</button>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span class="flex flex-wrap items-center gap-2">
            <LicenceBadge :licence="current.licence" :creator="current.creator" :rights-holder="current.rightsHolder" />
            <span v-if="current.publisher" class="text-xs text-muted">via {{ current.publisher }}</span>
            <a
              :href="`https://www.gbif.org/occurrence/${current.occurrenceKey}`"
              target="_blank"
              rel="noopener"
              class="text-xs text-accent underline-offset-2 hover:underline"
            >
              Source record ↗
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
