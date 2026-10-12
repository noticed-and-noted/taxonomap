<script setup lang="ts">
/**
 * Mobile bottom sheet with three snap points (peek / half / full). Drag the
 * handle (pointer events) or use the handle button / arrow keys to snap.
 */
import { computed, ref, watch } from 'vue';

const props = defineProps<{ title: string; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const SNAPS = [0.22, 0.55, 0.92] as const;
const snap = ref(1);
const dragOffset = ref(0);
const dragging = ref(false);
let startY = 0;
let moved = false;
let startHeight = 0;

watch(
  () => props.open,
  (o) => {
    if (o) snap.value = 1;
  },
);

const height = computed(() => `calc(${(SNAPS[snap.value] ?? 0.55) * 100}dvh - ${dragOffset.value}px)`);
const snapLabel = computed(() => ['collapsed', 'half height', 'full height'][snap.value]);

function onDown(e: PointerEvent) {
  dragging.value = true;
  moved = false;
  startY = e.clientY;
  startHeight = (SNAPS[snap.value] ?? 0.55) * window.innerHeight;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onMoveDrag(e: PointerEvent) {
  if (!dragging.value) return;
  dragOffset.value = e.clientY - startY;
  if (Math.abs(dragOffset.value) > 4) moved = true;
}

function onUp() {
  if (!dragging.value) return;
  dragging.value = false;
  const h = startHeight - dragOffset.value;
  dragOffset.value = 0;
  // Dragged well below the lowest snap: close.
  if (h < SNAPS[0] * window.innerHeight * 0.6) {
    emit('close');
    return;
  }
  const frac = h / window.innerHeight;
  let best = 0;
  SNAPS.forEach((s, i) => {
    if (Math.abs(s - frac) < Math.abs((SNAPS[best] ?? 0) - frac)) best = i;
  });
  snap.value = best;
}

/** A tap (not a drag) on the handle cycles through the snap points. */
function onHandleClick() {
  if (!moved) snap.value = (snap.value + 1) % SNAPS.length;
  moved = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    snap.value = Math.min(SNAPS.length - 1, snap.value + 1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (snap.value === 0) emit('close');
    else snap.value--;
  } else if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <Transition name="sheet">
    <section
      v-if="open"
      class="bottom-sheet absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-lg border-t border-border bg-surface shadow-panel"
      :class="{ dragging }"
      :style="{ height }"
      :aria-label="title"
    >
      <button
        type="button"
        class="handle-btn mx-auto flex w-full touch-none justify-center pb-1 pt-2"
        :aria-label="`Resize panel (currently ${snapLabel})`"
        @pointerdown="onDown"
        @pointermove="onMoveDrag"
        @pointerup="onUp"
        @pointercancel="onUp"
        @click="onHandleClick"
        @keydown="onKey"
      >
        <span class="block h-1 w-10 rounded-full bg-border-strong"></span>
      </button>
      <header class="flex items-center justify-between gap-2 px-4 pb-2">
        <h2 class="truncate font-display text-lg">{{ title }}</h2>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2"
          aria-label="Close panel"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <slot />
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.bottom-sheet {
  transition: height var(--dur) var(--ease);
}
.bottom-sheet.dragging {
  transition: none;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: transform var(--dur-slow) var(--ease);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}
</style>
