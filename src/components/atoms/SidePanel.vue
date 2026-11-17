<script setup lang="ts">
/**
 * Right-hand panel. `collapsible` swaps the close button for a tab on the
 * panel's left edge that slides the whole panel, unchanged, off the screen
 * edge until only the tab shows, and back again; `closable` keeps the close
 * button alongside it. `tabLabel` writes a word up the tab and names the tab
 * "<word> panel" (`aria-expanded` says whether the panel is out).
 */
import { computed } from 'vue';

const props = defineProps<{
  title: string;
  open: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  closable?: boolean;
  closeLabel?: string | undefined;
  tabLabel?: string | undefined;
}>();
const emit = defineEmits<{ close: []; collapse: []; expand: [] }>();

// "panel" keeps the tab apart from any button with the same word (the header's Near me).
const tabName = computed(() =>
  props.tabLabel ? `${props.tabLabel} panel` : `${props.collapsed ? 'Show' : 'Hide'} ${props.title}`,
);
</script>

<template>
  <Transition name="slide">
    <div
      v-if="open"
      class="side-panel absolute bottom-3 right-3 top-3 z-20 w-[var(--panel-width)]"
      :class="{ collapsed }"
    >
      <button
        v-if="collapsible"
        type="button"
        class="edge-tab absolute -z-10 right-full [clip-path:inset(-30px_0_-30px_-30px)] top-1/2 flex w-6 -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-l-md border border-r-0 border-border bg-surface text-muted shadow-panel hover:text-text"
        :class="tabLabel ? 'py-3' : 'h-14'"
        :aria-label="tabName"
        :aria-expanded="!collapsed"
        @click="collapsed ? emit('expand') : emit('collapse')"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path :d="collapsed ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'" />
        </svg>
        <span v-if="tabLabel" class="tab-label" aria-hidden="true">{{ tabLabel }}</span>
      </button>
      <aside
        class="flex size-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-panel"
        :aria-label="title"
        :inert="collapsed"
      >
        <header class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 class="truncate font-display text-lg">{{ title }}</h2>
          <slot name="actions" />
          <button
            v-if="!collapsible || closable"
            type="button"
            class="grid size-11 place-items-center sm:size-8 rounded-md text-muted hover:bg-surface-2 hover:text-text"
            :aria-label="closeLabel ?? 'Close panel'"
            @click="emit('close')"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <!-- Fixed above the scrolling body (e.g. tabs). -->
        <div v-if="$slots.top" class="px-4 pt-1"><slot name="top" /></div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <slot />
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.side-panel {
  transition: transform var(--dur-slow) var(--ease);
}
/* Past the panel's right margin too, so the tab sits against the screen edge. */
.side-panel.collapsed {
  transform: translateX(calc(100% + 0.75rem));
}
/* Reads bottom to top, as spine labels do. */
.tab-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 0.8125rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
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
