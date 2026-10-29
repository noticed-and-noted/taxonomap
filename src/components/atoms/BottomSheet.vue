<script setup lang="ts">
/**
 * Mobile bottom sheet with three snap points (peek / half / full). Drag the
 * handle or header (pointer events) or use the handle button / arrow keys to snap.
 */
import { computed, ref, watch } from 'vue';

const props = defineProps<{ title: string; open: boolean; closeLabel?: string | undefined }>();
/** `closed` fires once the sheet has slid away. */
const emit = defineEmits<{ close: []; closed: [] }>();

const SNAPS = [0.22, 0.55, 0.92] as const;
const snap = ref(1);
const dragOffset = ref(0);
const dragging = ref(false);
let startY = 0;
let moved = false;
let startHeight = 0;

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) snap.value = 1;
  },
);

const height = computed(() => `calc(${(SNAPS[snap.value] ?? 0.55) * 100}dvh - ${dragOffset.value}px)`);
const snapLabel = computed(() => ['collapsed', 'half height', 'full height'][snap.value]);

function onDown(event: PointerEvent) {
  dragging.value = true;
  moved = false;
  startY = event.clientY;
  startHeight = (SNAPS[snap.value] ?? 0.55) * window.innerHeight;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onMoveDrag(event: PointerEvent) {
  if (!dragging.value) return;
  dragOffset.value = event.clientY - startY;
  if (Math.abs(dragOffset.value) > 4) moved = true;
}

function onUp() {
  if (!dragging.value) return;
  dragging.value = false;
  const sheetHeight = startHeight - dragOffset.value;
  dragOffset.value = 0;
  // Dragged well below the lowest snap: close.
  if (sheetHeight < SNAPS[0] * window.innerHeight * 0.6) {
    emit('close');
    return;
  }
  const frac = sheetHeight / window.innerHeight;
  let best = 0;
  SNAPS.forEach((snapPoint, index) => {
    if (Math.abs(snapPoint - frac) < Math.abs((SNAPS[best] ?? 0) - frac)) best = index;
  });
  snap.value = best;
}

/** A tap (not a drag) on the handle cycles through the snap points. */
function onHandleClick() {
  if (!moved) snap.value = (snap.value + 1) % SNAPS.length;
  moved = false;
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    snap.value = Math.min(SNAPS.length - 1, snap.value + 1);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (snap.value === 0) emit('close');
    else snap.value--;
  } else if (event.key === 'Escape') emit('close');
}
</script>

<template>
  <!-- appear: a sheet created already open (near me, a panel in a shared link) slides up too. -->
  <Transition name="sheet" appear @after-leave="emit('closed')">
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
      <header
        class="flex touch-none items-center justify-between gap-2 px-4 pb-2"
        @pointerdown="onDown"
        @pointermove="onMoveDrag"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <h2 class="truncate font-display text-lg">{{ title }}</h2>
        <slot name="actions" />
        <button
          type="button"
          class="grid size-11 place-items-center sm:size-8 rounded-md text-muted hover:bg-surface-2"
          :aria-label="closeLabel ?? 'Close panel'"
          @pointerdown.stop
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <!-- Fixed above the scrolling body (e.g. tabs). -->
      <div v-if="$slots.top" class="px-4"><slot name="top" /></div>
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
