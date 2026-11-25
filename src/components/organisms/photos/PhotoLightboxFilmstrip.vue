<script setup lang="ts">
/** The lightbox's strip of thumbnails: the current photo is marked, and kept scrolled into view. */
import { nextTick, onMounted, ref, watch } from 'vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import { useScrollFade } from '~/composables/useScrollFade';
import type { UsableImage } from '~/lib/gbif';

const props = defineProps<{ images: readonly UsableImage[]; current: number; name: string }>();
const emit = defineEmits<{ select: [position: number] }>();

const strip = ref<HTMLElement>();
const { fadeLeft, fadeRight, update: updateFade } = useScrollFade(strip);

/** Scrolls the current thumbnail into view and refreshes the edge fades. */
async function revealCurrent() {
  await nextTick();
  strip.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateFade();
}

watch([() => props.current, () => props.images], revealCurrent);
onMounted(revealCurrent);
</script>

<template>
  <!-- Padded inside the scroller so the thumbnails' focus rings aren't clipped. -->
  <div
    ref="strip"
    class="filmstrip pointer-events-auto flex max-w-full gap-1.5 self-start overflow-x-auto overflow-y-hidden p-1"
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
      :aria-pressed="position === current"
      :aria-label="`Photo ${position + 1} of ${images.length}`"
      @click="emit('select', position)"
    >
      <ThumbImage :image="image" size="200x" class="size-full object-cover" />
    </button>
  </div>
</template>

<style scoped>
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
/* 44 px so they work as touch targets; the current photo gets the accent border. */
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
</style>
