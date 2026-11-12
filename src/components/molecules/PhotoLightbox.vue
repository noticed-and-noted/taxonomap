<script setup lang="ts">
/**
 * <dialog> lightbox over a set of photos, with keyboard navigation and a
 * filmstrip when there are several. Every photo shows its licence and creator,
 * and links to where it came from. Photos swap immediately, showing a skeleton
 * until the new one loads, and neighbours are preloaded so stepping through is
 * usually instant. Open it with the exposed `open(index)`. Up and down arrows (or swipes) call `onStepRow` (`@step-row`),
 * so a list of records can move the lightbox to its neighbours; with no photos it says so. Desktop gets a key legend.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import LicenceBadge from '~/components/atoms/LicenceBadge.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { usePhotoPreload } from '~/composables/usePhotoPreload';
import { useSwipe } from '~/composables/useSwipe';
import { photoCrossOrigin, thumbnailUrl, type UsableImage } from '~/lib/gbif';
import { $lightboxOpen } from '~/stores/lightbox';
import PhotoLightboxFilmstrip from './PhotoLightboxFilmstrip.vue';

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

/** Tapping the photo hides everything over it, for an unobstructed look; tapping again brings it back. */
const areControlsHidden = ref(false);
const toggleControls = () => (areControlsHidden.value = !areControlsHidden.value);

const { settled, failed, attempt, settle, onError, preload } = usePhotoPreload();

/** Preloads the photos either side, and the next record's first. */
function preloadAround(imageIndex: number) {
  const count = props.images.length;
  preload(props.images[(imageIndex + 1) % count]);
  preload(props.images[(imageIndex - 1 + count) % count]);
  preload(props.nextRowImage);
}

/** Shows one photo, preloading its neighbours. */
function show(imageIndex: number) {
  index.value = imageIndex;
  preloadAround(imageIndex);
}

/**
 * Open the lightbox on one photo.
 * @param imageIndex Position in `images`.
 */
function open(imageIndex: number) {
  isOpen.value = true;
  $lightboxOpen.set(true);
  areControlsHidden.value = false;
  // Already open when a list steps to its next record.
  if (!dialog.value?.open) dialog.value?.showModal();
  show(imageIndex);
}

/** Steps through the photos, wrapping at either end. */
function step(delta: number) {
  const count = props.images.length;
  if (count < 2) return;
  show((index.value + delta + count) % count);
}

const ROW_KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Left and right step through the photos; up and down through the records. */
function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') step(1);
  else if (event.key === 'ArrowLeft') step(-1);
  else if (event.key in ROW_KEYS) {
    event.preventDefault();
    props.onStepRow?.(ROW_KEYS[event.key]!);
  }
}

// A sideways swipe steps through the photos; an upright one through the records, as the arrow keys do.
const { isPinchZoomed, onPointerDown, onPointerUp, onPointerCancel } = useSwipe({
  onSideways: step,
  onUpright: (delta) => props.onStepRow?.(delta),
});

/** The touch hint's arrows: up and down for records, left and right for photos, both when there are both. */
const swipeIcon = computed(() => {
  const hasPhotos = props.images.length > 1;
  if (props.onStepRow) return hasPhotos ? 'arrows-all' : 'arrows-vertical';
  return hasPhotos ? 'arrows-horizontal' : undefined;
});

/** Unmounts the photo and lets the map run again. */
function onClose() {
  isOpen.value = false;
  $lightboxOpen.set(false);
}

// A page swap can unmount the lightbox while it's open, which fires no close event.
onBeforeUnmount(() => {
  if (isOpen.value) $lightboxOpen.set(false);
});

/** A click on the backdrop, outside the stage, closes the dialog. */
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
    @close="onClose"
  >
    <div
      v-if="isOpen"
      class="stage absolute inset-0"
      :class="{ 'controls-hidden': areControlsHidden, 'swipes-rows': onStepRow, 'pinch-zoomed': isPinchZoomed }"
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
        @error="onError(currentSrc)"
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
        <PhotoLightboxFilmstrip
          v-if="images.length > 1"
          class="overlay"
          :images="images"
          :current="index"
          :name="name"
          @select="show"
        />
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
/* Zoomed in, the browser pans the zoomed page every way (onPointerDown skips swipes then). */
.stage.pinch-zoomed {
  touch-action: auto;
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
