<script setup lang="ts">
/**
 * A small "i" button that shows a short explanation beside it: on hover or focus, or a tap on phones, and gone on
 * Escape, a tap elsewhere or moving away. The explanation is the default slot.
 */
import { onBeforeUnmount, ref, useId } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';

defineProps<{ label: string }>();

const isOpen = ref(false);
const tipId = useId();
const root = ref<HTMLElement>();

/** A press outside closes it. */
function onDocumentPointer(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}

function open() {
  if (isOpen.value) return;
  isOpen.value = true;
  document.addEventListener('pointerdown', onDocumentPointer);
}

function close() {
  isOpen.value = false;
  document.removeEventListener('pointerdown', onDocumentPointer);
}

const toggle = () => (isOpen.value ? close() : open());

onBeforeUnmount(close);
</script>

<template>
  <span
    ref="root"
    class="relative inline-flex"
    @mouseenter="open"
    @mouseleave="close"
    @focusin="open"
    @focusout="close"
    @keydown.esc="close"
  >
    <button
      type="button"
      class="info-button grid size-6 place-items-center rounded-full text-subtle hover:text-text"
      :aria-label="label"
      :aria-describedby="isOpen ? tipId : undefined"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <UiIcon name="info" />
    </button>
    <span
      v-show="isOpen"
      :id="tipId"
      role="tooltip"
      class="absolute top-full -left-2 z-10 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-normal text-muted shadow-panel"
    >
      <slot />
    </span>
  </span>
</template>

<style scoped>
.info-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
@media (pointer: coarse) {
  .info-button {
    width: 2.75rem;
    height: 2.75rem;
  }
}
</style>
