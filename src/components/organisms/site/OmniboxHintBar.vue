<script setup lang="ts">
/** The header search's keyboard hints: what Enter does now, and the modifier shortcuts that apply. */
defineProps<{
  /** What Enter does for the highlighted row. */
  enterLabel: string;
  /** Whether Cmd/Ctrl-Enter opens the previewed result's About page. */
  canOpenAbout: boolean;
  /** Where Cmd/Ctrl-Shift-Enter switches to ("Places" or "Species"), when it applies. */
  switchLabel?: string | undefined;
}>();

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const modifierKey = isMac ? '⌘' : 'Ctrl';
</script>

<template>
  <p class="hint-bar" aria-hidden="true">
    <span><kbd>↵</kbd> {{ enterLabel }}</span>
    <span v-if="canOpenAbout"
      ><kbd>{{ modifierKey }}</kbd> <kbd>↵</kbd> About</span
    >
    <span v-if="switchLabel"
      ><kbd>{{ modifierKey }}</kbd> <kbd>⇧</kbd> <kbd>↵</kbd> {{ switchLabel }}</span
    >
    <span><kbd>↑</kbd> <kbd>↓</kbd> Move</span>
  </p>
</template>

<style scoped>
/* Keyboard hints: only where there is likely a keyboard. */
.hint-bar {
  display: none;
  gap: 1rem;
  padding: 0.375rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.6875rem;
  color: var(--text-subtle);
}
@media (min-width: 640px) and (hover: hover) {
  .hint-bar {
    display: flex;
  }
}
kbd {
  display: inline-grid;
  place-items: center;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  font-family: inherit;
  font-size: 0.625rem;
  color: var(--text-muted);
}
</style>
