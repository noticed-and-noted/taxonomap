<script setup lang="ts">
defineProps<{ title: string; open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="open"
      class="side-panel absolute bottom-3 right-3 top-3 z-20 flex w-[var(--panel-width)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-panel"
      :aria-label="title"
    >
      <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 class="truncate font-display text-lg">{{ title }}</h2>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Close panel"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <slot />
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition:
    transform var(--dur-slow) var(--ease),
    opacity var(--dur-slow) var(--ease);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
</style>
