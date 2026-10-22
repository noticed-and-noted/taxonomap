<script setup lang="ts">
/**
 * <dialog> lightbox over a set of photos, with keyboard navigation and a
 * filmstrip when there are several. Every photo shows its licence and creator,
 * and links to where it came from. Photos swap immediately, showing a skeleton
 * until the new one loads, and neighbours are preloaded so stepping through is
 * usually instant. Open it with the exposed `open(index)`.
 */
import { computed, nextTick, reactive, ref } from 'vue';
import { countRequest, photoCrossOrigin, retryWithoutCors, thumbnailUrl, type UsableImage } from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';
import UiIcon from './UiIcon.vue';

const props = defineProps<{ images: readonly UsableImage[]; name: string }>();

/** Where a photo came from: its GBIF record, or its iNaturalist observation (or photo page). */
function sourceOf(image: UsableImage): { href: string; label: string } {
  if (image.source === 'inat') {
    return {
      href: image.observationUrl ?? `https://www.inaturalist.org/photos/${image.photoId}`,
      label: image.observationUrl ? 'Observation' : 'Photo',
    };
  }
  return { href: `https://www.gbif.org/occurrence/${image.occurrenceKey}`, label: 'Source record' };
}

const dialog = ref<HTMLDialogElement>();
const index = ref(0);
/** The photo renders only while open, so none is fetched (or server-rendered) up front. */
const isOpen = ref(false);
const current = computed(() => props.images[index.value]);
const currentSrc = computed(() => (current.value ? thumbnailUrl(current.value, '800x') : undefined));

/** Photo URLs that have finished loading (or failed), so their skeletons can go. */
const settled = reactive(new Set<string>());
const failed = reactive(new Set<string>());
const preloading = new Set<string>();
/** Bumped to remount the <img> for a retry without crossorigin. */
const attempt = ref(0);

function onLightboxError(url: string) {
  if (retryWithoutCors(url)) attempt.value++;
  else settle(url, false);
}

function settle(url: string, ok: boolean) {
  if (settled.has(url)) return;
  countRequest('image');
  settled.add(url);
  if (!ok) failed.add(url);
}

function preload(imageIndex: number) {
  const image = props.images[imageIndex];
  if (!image) return;
  const url = thumbnailUrl(image, '800x');
  if (settled.has(url) || preloading.has(url)) return;
  preloading.add(url);
  const element = new Image();
  element.decoding = 'async';
  // Same mode as the <img> below, so the preloaded copy is the one it uses.
  const cors = photoCrossOrigin(url);
  if (cors) element.crossOrigin = cors;
  element.onload = () => settle(url, true);
  element.onerror = () => {
    if (!retryWithoutCors(url)) return settle(url, false);
    preloading.delete(url);
    preload(imageIndex);
  };
  element.src = url;
}

function preloadAround(imageIndex: number) {
  const count = props.images.length;
  preload((imageIndex + 1) % count);
  preload((imageIndex - 1 + count) % count);
}

const strip = ref<HTMLElement>();

function show(imageIndex: number) {
  index.value = imageIndex;
  preloadAround(imageIndex);
  void nextTick(() =>
    strip.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  );
}

/**
 * Open the lightbox on one photo.
 * @param imageIndex Position in `images`.
 */
function open(imageIndex: number) {
  isOpen.value = true;
  areControlsHidden.value = false;
  dialog.value?.showModal();
  show(imageIndex);
}

function step(delta: number) {
  const count = props.images.length;
  show((index.value + delta + count) % count);
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') step(1);
  else if (event.key === 'ArrowLeft') step(-1);
}

/** Tapping the photo hides everything over it, for an unobstructed look; tapping again brings it back. */
const areControlsHidden = ref(false);
const toggleControls = () => (areControlsHidden.value = !areControlsHidden.value);

/** Horizontal travel, in px, that makes a touch a swipe rather than a tap. */
const SWIPE_DISTANCE = 50;
let swipeStart: { x: number; y: number } | null = null;

function onPointerDown(event: PointerEvent) {
  swipeStart = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null;
}

/** The browser took the gesture over (say, scrolling the filmstrip), so it isn't a swipe. */
function onPointerCancel() {
  swipeStart = null;
}

/** A mostly sideways swipe steps through the photos: left for the next, right for the previous. */
function onPointerUp(event: PointerEvent) {
  if (!swipeStart || props.images.length < 2) return;
  const deltaX = event.clientX - swipeStart.x;
  const deltaY = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(deltaX) >= SWIPE_DISTANCE && Math.abs(deltaX) > Math.abs(deltaY)) step(deltaX < 0 ? 1 : -1);
}

function onBackdrop(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value?.close();
}

defineExpose({ open });
</script>

<template>
  <!-- Black stage and white-on-dark overlays in both themes: they sit over the photo, not the page. -->
  <dialog
    ref="dialog"
    class="lightbox m-auto h-[min(88dvh,52rem)] w-[min(64rem,94vw)] overflow-hidden overscroll-contain rounded-lg border border-border bg-black p-0 text-white shadow-panel backdrop:bg-black/80"
    :aria-label="`${name} photos`"
    @keydown="onKey"
    @click="onBackdrop"
    @close="isOpen = false"
  >
    <div
      v-if="current && isOpen"
      class="stage absolute inset-0"
      :class="{ 'controls-hidden': areControlsHidden }"
      @click.self="toggleControls"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
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
        class="absolute inset-0 grid place-items-center text-sm text-white/70"
      >
        Couldn't load this photo
      </p>
      <img
        v-if="currentSrc && !failed.has(currentSrc)"
        :key="`${currentSrc}#${attempt}`"
        :src="currentSrc"
        :crossorigin="photoCrossOrigin(currentSrc)"
        :alt="name"
        decoding="async"
        class="relative size-full object-contain transition-opacity duration-200"
        :class="settled.has(currentSrc) ? 'opacity-100' : 'opacity-0'"
        @load="settle(currentSrc, true)"
        @error="onLightboxError(currentSrc)"
        @click="toggleControls"
      />

      <!-- The credit rides with the count, clear of the close button and the strip. -->
      <div class="overlay absolute left-2 top-2 flex min-h-11 max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-1.5">
        <span class="chip tabular-nums">{{ index + 1 }} / {{ images.length }}</span>
        <LicenceBadge :licence="current.licence" :creator="current.creator" :rights-holder="current.rightsHolder" />
        <p class="chip m-0 flex items-center gap-2">
          <span v-if="current.publisher">via {{ current.publisher }}</span>
          <a
            :href="sourceOf(current).href"
            target="_blank"
            rel="noopener"
            class="text-white underline decoration-white/60 underline-offset-2 hover:decoration-white"
          >
            {{ sourceOf(current).label }} <UiIcon name="external" />
          </a>
        </p>
      </div>
      <form method="dialog">
        <button class="overlay-button right-2 top-2" aria-label="Close"><UiIcon name="close" size="20" /></button>
      </form>
      <template v-if="images.length > 1">
        <button type="button" class="overlay-button nav left-2" aria-label="Previous photo" @click="step(-1)">
          <UiIcon name="arrow-left" size="20" />
        </button>
        <button type="button" class="overlay-button nav right-2" aria-label="Next photo" @click="step(1)">
          <UiIcon name="arrow-right" size="20" />
        </button>
      </template>

      <!-- Clicks pass through the full-width band, so taps beside the strip still reach the photo. -->
      <div class="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center">
        <!-- Padded inside the scroller so the thumbnails' focus rings aren't clipped. -->
        <div
          v-if="images.length > 1"
          ref="strip"
          class="overlay pointer-events-auto flex max-w-full scroll-px-1 gap-1.5 overflow-x-auto p-1"
          role="group"
          :aria-label="`Photos of ${name}`"
        >
          <button
            v-for="(image, position) in images"
            :key="image.url"
            type="button"
            class="filmstrip-thumb bg-photo"
            :aria-pressed="position === index"
            :aria-label="`Photo ${position + 1} of ${images.length}`"
            @click="show(position)"
          >
            <ThumbImage :image="image" size="200x" class="size-full object-cover" />
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
/* Matches LicenceBadge, so every pill over the photo looks the same. */
.chip {
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(8px);
  font-size: 11px;
  line-height: 1.25;
}
.overlay-button {
  position: absolute;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius);
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(8px);
  color: white;
}
.overlay-button:hover {
  background: rgb(0 0 0 / 0.8);
}
.overlay-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.nav {
  top: 50%;
  translate: 0 -50%;
}
/* 44 px so they work as touch targets; the current photo gets the accent border. */
.filmstrip-thumb {
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
/* The others are dimmed too: Rust alone barely shows on the black stage in the light theme. */
.filmstrip-thumb:not([aria-pressed='true']) {
  opacity: 0.6;
  transition: opacity var(--dur-fast) var(--ease);
}
.filmstrip-thumb:hover {
  opacity: 1;
}
.filmstrip-thumb[aria-pressed='true'] {
  border-color: var(--accent);
}
.filmstrip-thumb:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.lightbox[open] {
  animation: pop var(--dur) var(--ease);
}
/* Sideways drags are swipes (see onPointerUp); the browser keeps vertical panning and pinch-zoom. */
.stage {
  touch-action: pan-y pinch-zoom;
}
/* Visibility as well as opacity, so hidden controls can't be tabbed to or tapped. */
.overlay,
.overlay-button {
  transition:
    opacity var(--dur-fast) var(--ease),
    visibility var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}
.controls-hidden :is(.overlay, .overlay-button) {
  opacity: 0;
  visibility: hidden;
}
/* Safari focuses the dialog itself on open; it's a container, not a control, so it gets no ring. */
.lightbox:focus-visible {
  outline: none;
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
