<script setup lang="ts">
/**
 * <dialog> lightbox over a set of photos, with keyboard navigation and a
 * filmstrip when there are several. Every photo shows its licence and creator,
 * and links to where it came from. Photos swap immediately, showing a skeleton
 * until the new one loads, and neighbours are preloaded so stepping through is
 * usually instant. Open it with the exposed `open(index)`. Up and down arrows (or swipes) call `onStepRow` (`@step-row`),
 * so a list of records can move the lightbox to its neighbours; with no photos it says so. Desktop gets a key legend.
 */
import { computed, nextTick, reactive, ref } from 'vue';
import { countRequest, photoCrossOrigin, retryWithoutCors, thumbnailUrl, type UsableImage } from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';
import UiIcon from './UiIcon.vue';
import { useScrollFade } from './useScrollFade';

/**
 * `href`, when given, links the name (to the species' about page). `nextRowImage` is preloaded so stepping down a row
 * is instant. `loading` shows the photo skeleton while the list fetches the next record.
 */
// `onStepRow` is a prop rather than an emit so the legend can tell whether anyone handles it.
const props = defineProps<{
  images: readonly UsableImage[];
  name: string;
  href?: string | undefined;
  onStepRow?: ((delta: number) => void) | undefined;
  nextRowImage?: UsableImage | undefined;
  loading?: boolean;
}>();

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

function preload(image: UsableImage | undefined) {
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
    preload(image);
  };
  element.src = url;
}

function preloadAround(imageIndex: number) {
  const count = props.images.length;
  preload(props.images[(imageIndex + 1) % count]);
  preload(props.images[(imageIndex - 1 + count) % count]);
  preload(props.nextRowImage);
}

const strip = ref<HTMLElement>();
const { fadeLeft, fadeRight, update: updateFade } = useScrollFade(strip);

function show(imageIndex: number) {
  index.value = imageIndex;
  preloadAround(imageIndex);
  void nextTick(() => {
    strip.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateFade();
  });
}

/**
 * Open the lightbox on one photo.
 * @param imageIndex Position in `images`.
 */
function open(imageIndex: number) {
  isOpen.value = true;
  areControlsHidden.value = false;
  // Already open when a list steps to its next record.
  if (!dialog.value?.open) dialog.value?.showModal();
  show(imageIndex);
}

function step(delta: number) {
  const count = props.images.length;
  if (count < 2) return;
  show((index.value + delta + count) % count);
}

const ROW_KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') step(1);
  else if (event.key === 'ArrowLeft') step(-1);
  else if (event.key in ROW_KEYS) {
    event.preventDefault();
    props.onStepRow?.(ROW_KEYS[event.key]!);
  }
}

/** Tapping the photo hides everything over it, for an unobstructed look; tapping again brings it back. */
const areControlsHidden = ref(false);
const toggleControls = () => (areControlsHidden.value = !areControlsHidden.value);

/** Travel, in px, that makes a touch a swipe rather than a tap. */
const SWIPE_DISTANCE = 50;
let swipeStart: { x: number; y: number } | null = null;

function onPointerDown(event: PointerEvent) {
  swipeStart = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null;
}

/** The browser took the gesture over (say, scrolling the filmstrip), so it isn't a swipe. */
function onPointerCancel() {
  swipeStart = null;
}

/**
 * A mostly sideways swipe steps through the photos: left for the next, right for the previous. A mostly upright one
 * steps through the records, as the up and down arrows do: up for the next, down for the previous.
 */
function onPointerUp(event: PointerEvent) {
  if (!swipeStart) return;
  const deltaX = event.clientX - swipeStart.x;
  const deltaY = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (Math.abs(deltaX) >= SWIPE_DISTANCE) step(deltaX < 0 ? 1 : -1);
  } else if (Math.abs(deltaY) >= SWIPE_DISTANCE) props.onStepRow?.(deltaY < 0 ? 1 : -1);
}

/** The touch hint's arrows: up and down for records, left and right for photos, both when there are both. */
const swipeIcon = computed(() => {
  const hasPhotos = props.images.length > 1;
  if (props.onStepRow) return hasPhotos ? 'arrows-all' : 'arrows-vertical';
  return hasPhotos ? 'arrows-horizontal' : undefined;
});

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
      v-if="isOpen"
      class="stage absolute inset-0"
      :class="{ 'controls-hidden': areControlsHidden, 'swipes-rows': onStepRow }"
      @click.self="toggleControls"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <SkeletonBlock
        v-if="loading || (currentSrc && !settled.has(currentSrc))"
        class="photo-skeleton absolute inset-0"
        width="100%"
        height="100%"
        rounded="sm"
        :label="loading ? 'Loading record' : 'Loading photo'"
      />
      <p v-else-if="!current" class="absolute inset-0 m-0 grid place-items-center text-sm text-white/70">
        No image recorded
      </p>
      <p
        v-else-if="currentSrc && failed.has(currentSrc)"
        class="absolute inset-0 grid place-items-center text-sm text-white/70"
      >
        Couldn't load this photo
      </p>
      <img
        v-if="!loading && currentSrc && !failed.has(currentSrc)"
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

      <!-- Count and name, level with the close button. The name stays with no photo. -->
      <div class="overlay absolute left-2 top-4 flex max-w-[calc(100%-4.5rem)] items-center gap-1.5">
        <span v-if="current" class="chip chip-title tabular-nums">{{ index + 1 }} / {{ images.length }}</span>
        <a
          v-if="name && href"
          :href="href"
          class="chip chip-title truncate text-white no-underline underline-offset-2 hover:underline focus-visible:underline"
          >{{ name }}</a
        >
        <span v-else-if="name" class="chip chip-title truncate">{{ name }}</span>
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

      <!-- The strip, from the left, with the credit and key hints beneath it.
           Clicks pass through the band, so taps beside them still reach the photo. -->
      <div class="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
        <!-- Padded inside the scroller so the thumbnails' focus rings aren't clipped. -->
        <div
          v-if="images.length > 1"
          ref="strip"
          class="filmstrip overlay pointer-events-auto flex max-w-full gap-1.5 self-start overflow-x-auto overflow-y-hidden p-1"
          :class="{ 'fade-left': fadeLeft, 'fade-right': fadeRight }"
          role="group"
          :aria-label="`Photos of ${name}`"
          @scroll.passive="updateFade"
        >
          <button
            v-for="(image, position) in images"
            :key="image.url"
            type="button"
            class="filmstrip-thumb"
            :aria-pressed="position === index"
            :aria-label="`Photo ${position + 1} of ${images.length}`"
            @click="show(position)"
          >
            <ThumbImage :image="image" size="200x" class="size-full object-cover" />
          </button>
        </div>
        <!-- Side by side at any width; when space runs short both sides stack (see .bottom-row). -->
        <div class="bottom-row overlay flex items-end justify-between gap-1.5">
          <div v-if="current" class="credit pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5">
            <LicenceBadge
              class="bottom-pill"
              :licence="current.licence"
              :creator="current.creator"
              :rights-holder="current.rightsHolder"
            />
            <p class="chip bottom-pill m-0 flex items-center gap-2">
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
          <!-- ml-auto keeps it right when there's no credit beside it (no photo). -->
          <p
            class="chip bottom-pill key-hints m-0 ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1"
            aria-hidden="true"
          >
            <span v-if="images.length > 1" class="keys-only"><kbd>←</kbd> <kbd>→</kbd> Photos</span>
            <span v-if="onStepRow" class="keys-only"><kbd>↑</kbd> <kbd>↓</kbd> Records</span>
            <span class="keys-only"><kbd>Esc</kbd> Close</span>
            <span v-if="swipeIcon" class="touch-only flex items-center gap-1 whitespace-nowrap">
              <UiIcon :name="swipeIcon" size="14" /> Swipe
            </span>
            <span class="flex items-center gap-1 whitespace-nowrap">
              <UiIcon name="mouse" size="14" class="keys-only" /><UiIcon name="touch" size="14" class="touch-only" />
              Hide UI
            </span>
          </p>
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
  font-size: 0.6875rem;
  line-height: 1.25;
}
/* After .chip, and scoped so it also beats LicenceBadge's own padding. */
.bottom-pill {
  padding-block: 4px;
}
/* The count and name lead the credit, so they read first. */
/* 1.75rem tall, so with the overlay at top-4 it centres on the 2.75rem close button at top-2. */
.chip-title {
  padding: 0 0.5rem;
  font-size: 0.875rem;
  line-height: 1.75rem;
}
/* Keyboard hints and the mouse icon only where there's likely a keyboard, as in the Omnibox; touch screens get the
   touch icon. Scoped under .key-hints to beat UiIcon's own display. */
.key-hints {
  color: rgb(255 255 255 / 0.75);
}
.key-hints .keys-only {
  display: none;
}
/* Once the row is too narrow for the credit and all the hints on one line, both sides stack together: the credit
   pills one above the other, the hints two by two rather than wrapping three and one.
   shortcut: the width is a typical credit plus four hints; measure the row if long credits wrap them early. */
.bottom-row {
  container-type: inline-size;
}
@container (max-width: 42rem) {
  .credit {
    flex-direction: column;
    align-items: flex-start;
  }
  .key-hints {
    display: grid;
    grid-template-columns: repeat(2, auto);
  }
}
@media (min-width: 640px) and (hover: hover) {
  .key-hints .keys-only {
    display: inline;
  }
  .key-hints .touch-only {
    display: none;
  }
}
kbd {
  display: inline-grid;
  place-items: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  border-radius: 4px;
  border: 1px solid rgb(255 255 255 / 0.4);
  font-family: inherit;
  font-size: 0.625rem;
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
/* Snaps to a whole thumbnail. The scroll padding matches the fade, so the snapped and current thumbnails sit clear of it. */
.filmstrip {
  --fade: 1.5rem;
  --fade-left: 0px;
  --fade-right: 0px;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: var(--fade);
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 var(--fade-left),
    #000 calc(100% - var(--fade-right)),
    transparent 100%
  );
}
.filmstrip.fade-left {
  --fade-left: var(--fade);
}
.filmstrip.fade-right {
  --fade-right: var(--fade);
}
.filmstrip-thumb {
  scroll-snap-align: start;
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  overflow: hidden;
  /* A themed frame around each thumbnail; the backing stops inside it, so the selected outline is accent alone. */
  --thumb-backing: rgb(0 0 0 / 0.3);
  --thumb-border: rgb(0 0 0 / 0.3);
  border: 2px solid var(--thumb-border);
  border-radius: var(--radius-sm);
  background: var(--thumb-backing) padding-box;
  backdrop-filter: blur(8px);
  cursor: pointer;
}
:root[data-theme='light'] .filmstrip-thumb {
  --thumb-border: rgb(255 255 255 / 0.3);
}
/* The others are dimmed too: Rust alone barely shows on the black stage in the light theme.
   The image dims, not the button, so the blurred backing behind it shows through like the nav buttons'. */
.filmstrip-thumb > * {
  transition: opacity var(--dur-fast) var(--ease);
}
.filmstrip-thumb:not([aria-pressed='true'], :hover) > * {
  opacity: 0.6;
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
/* Sideways drags are swipes (see onPointerUp); the browser keeps vertical panning and pinch-zoom, unless upright
   drags step through records too. */
.stage {
  touch-action: pan-y pinch-zoom;
}
.stage.swipes-rows {
  touch-action: pinch-zoom;
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
/* Pulses up from the black stage rather than shimmering grey, so a photo that loads quickly doesn't flash.
   .stage raises it above SkeletonBlock's own shimmer. */
.stage .photo-skeleton {
  background: rgb(255 255 255 / 0.08);
  animation: pulse-in 1.4s var(--ease) infinite;
}
@keyframes pulse-in {
  0%,
  100% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .lightbox[open],
  .stage .photo-skeleton {
    animation: none;
  }
}
</style>
