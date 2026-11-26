<script setup lang="ts">
/**
 * Phone mode switch: one accent button naming the current mode, which drops the other modes out
 * beneath it. Desktop uses a segmented control instead (ExplorerOverlay).
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { MODE_OPTIONS } from '~/lib/map-modes';
import { $mapMode, setMapMode, type MapMode } from '~/stores/mode';

const mode = useStore($mapMode);
const isOpen = ref(false);
const root = ref<HTMLElement>();

const current = computed(() => MODE_OPTIONS.find((option) => option.value === mode.value)!);
const others = computed(() => MODE_OPTIONS.filter((option) => option.value !== mode.value));

/** Switches to the picked mode and folds the menu away. */
function pick(next: MapMode) {
  isOpen.value = false;
  setMapMode(next);
}

/** A tap or click anywhere else closes the menu, as a native menu does. */
function closeOnOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) isOpen.value = false;
}

/** Escape closes the menu. */
function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') isOpen.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <div ref="root" class="mode-menu">
    <button
      type="button"
      class="mode-btn current"
      :aria-expanded="isOpen"
      aria-controls="mode-menu-list"
      :aria-label="`Mode: ${current.label}. Change mode`"
      data-tour="near"
      @click="isOpen = !isOpen"
    >
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path :d="current.icon" />
      </svg>
      {{ current.label }}
      <svg
        viewBox="0 0 24 24"
        class="chevron size-3.5"
        :class="{ open: isOpen }"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
    <ul v-show="isOpen" id="mode-menu-list" class="mode-list">
      <li v-for="option in others" :key="option.value">
        <button type="button" class="mode-btn" @click="pick(option.value)">
          <svg
            viewBox="0 0 24 24"
            class="size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path :d="option.icon" />
          </svg>
          {{ option.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mode-menu {
  position: relative;
}
.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 0.8125rem;
  white-space: nowrap;
  box-shadow: var(--shadow);
}
.mode-btn.current {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 500;
}
.chevron {
  transition: transform var(--dur-fast) var(--ease);
}
.chevron.open {
  transform: rotate(180deg);
}
.mode-list {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}
</style>
