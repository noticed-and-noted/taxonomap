<script setup lang="ts">
/**
 * Chart tooltip (hover, or tap on touch screens), centred above a viewport
 * point. A manual popover, so it sits in the top layer and escapes scrolling
 * or clipped panels.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{
  /** Viewport x (clientX). */
  x: number;
  /** Viewport y (clientY). */
  y: number;
}>();

/** Scrolled or tapped away: the chart should drop its hover state, so the next hover or tap mounts a fresh tip. */
const emit = defineEmits<{ dismiss: [] }>();

const tip = ref<HTMLDivElement>();
// Fixed to the viewport, so it would drift off its chart on scroll.
const hide = () => emit('dismiss');
// Touch has no pointerleave to dismiss it, so the next tap anywhere does; a tap on the chart re-shows it there.
const hideOnTap = (event: PointerEvent) => event.pointerType === 'touch' && hide();

onMounted(() => {
  tip.value?.showPopover();
  // Capture: scrolls inside panels and flyouts don't bubble to window.
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('pointerdown', hideOnTap, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', hide, { capture: true });
  window.removeEventListener('pointerdown', hideOnTap, { capture: true });
});
</script>

<template>
  <div
    ref="tip"
    popover="manual"
    class="pointer-events-none fixed bottom-auto right-auto m-0 max-w-64 -translate-x-1/2 -translate-y-[115%] overflow-visible rounded-md border border-border bg-surface px-3 py-2 text-xs text-text shadow-panel"
    :style="{ left: `${x}px`, top: `${y}px` }"
  >
    <slot />
  </div>
</template>
