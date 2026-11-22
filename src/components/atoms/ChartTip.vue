<script setup lang="ts">
/**
 * Tooltip (hover, or tap on touch screens) centred above a viewport point,
 * for charts and other hover hints. A manual popover, so it sits in the top layer and escapes scrolling
 * or clipped panels.
 */
import { onBeforeUnmount, onMounted, onUpdated, ref } from 'vue';

/** Least gap kept between the tip and the sides of the viewport. */
const EDGE_GAP_PX = 8;

defineProps<{
  /** Viewport x (clientX). */
  x: number;
  /** Viewport y (clientY). */
  y: number;
}>();

/** Scrolled or tapped away: the chart should drop its hover state, so the next hover or tap mounts a fresh tip. */
const emit = defineEmits<{ dismiss: [] }>();

const tip = ref<HTMLDivElement>();
/** How far the tip is shifted sideways from centre to stay on screen. */
const nudge = ref(0);
// Fixed to the viewport, so it would drift off its chart on scroll.
const hide = () => emit('dismiss');
// Touch has no pointerleave to dismiss it, so the next tap anywhere does; a tap on the chart re-shows it there.
const hideOnTap = (event: PointerEvent) => event.pointerType === 'touch' && hide();

/** Shift the tip sideways just enough that neither side runs off the viewport. */
function keepOnScreen(): void {
  if (!tip.value) return;
  const box = tip.value.getBoundingClientRect();
  const centredLeft = box.left - nudge.value;
  const centredRight = box.right - nudge.value;
  const overRight = centredRight - (window.innerWidth - EDGE_GAP_PX);
  const overLeft = EDGE_GAP_PX - centredLeft;
  nudge.value = overRight > 0 ? -overRight : Math.max(overLeft, 0);
}

onMounted(() => {
  tip.value?.showPopover();
  keepOnScreen();
  // Capture: scrolls inside panels and flyouts don't bubble to window.
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('pointerdown', hideOnTap, { capture: true });
});

// The point or text changed, so its width or room at the edge may have too.
onUpdated(keepOnScreen);

onBeforeUnmount(() => {
  window.removeEventListener('scroll', hide, { capture: true });
  window.removeEventListener('pointerdown', hideOnTap, { capture: true });
});
</script>

<template>
  <div
    ref="tip"
    popover="manual"
    class="pointer-events-none fixed bottom-auto right-auto m-0 w-max max-w-64 -translate-x-1/2 -translate-y-[115%] overflow-visible rounded-md border border-border bg-surface px-3 py-2 text-xs text-text shadow-panel"
    :style="{ left: `${x + nudge}px`, top: `${y}px` }"
  >
    <slot />
  </div>
</template>
