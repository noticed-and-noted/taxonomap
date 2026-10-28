<script setup lang="ts">
/**
 * A quiet status note: accent dot, message (the default slot) and one action
 * button. Shared by the app's notes so they all look alike.
 */
defineProps<{
  /** The button's label, e.g. "Reload". */
  action: string;
}>();

const emit = defineEmits<{ act: [] }>();
</script>

<template>
  <div
    role="status"
    class="flex items-center gap-2 rounded-md border border-border bg-surface py-1.5 pr-1.5 pl-3 text-xs text-muted shadow-panel"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
    <slot />
    <!-- The ::after stretches the hit area to 44px on phones without making the button look bigger. -->
    <button
      type="button"
      class="relative ml-auto shrink-0 rounded-sm border border-border-strong bg-surface-2 px-2.5 py-1 font-medium text-text transition-colors duration-(--dur-fast) ease-field after:absolute after:-inset-x-1.5 after:-inset-y-[9px] hover:bg-surface-3 sm:ml-2 sm:after:hidden"
      @click="emit('act')"
    >
      {{ action }}
    </button>
  </div>
</template>
