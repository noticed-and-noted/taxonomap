<script setup lang="ts">
/**
 * Wraps every chart in a <figure> with a caption and a data-table fallback
 * (WCAG: the same information must be available without the graphic).
 * Uses <details>, so it works on pre-rendered pages without any JavaScript.
 */
defineProps<{ title: string; caption?: string | undefined; compact?: boolean }>();
</script>

<template>
  <figure class="chart-frame" :class="compact ? 'text-xs' : 'text-sm'">
    <figcaption class="mb-2">
      <span class="font-medium text-text">{{ title }}</span>
      <span v-if="caption" class="ml-2 text-subtle">{{ caption }}</span>
    </figcaption>
    <slot />
    <details class="mt-1.5">
      <summary class="cursor-pointer text-xs text-muted hover:text-text">Show data table</summary>
      <div class="mt-2 max-h-56 overflow-auto rounded-sm border border-border">
        <slot name="table" />
      </div>
    </details>
  </figure>
</template>

<style scoped>
.chart-frame :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.chart-frame :deep(th),
.chart-frame :deep(td) {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.chart-frame :deep(td:last-child),
.chart-frame :deep(th:last-child) {
  text-align: right;
}
.chart-frame :deep(th) {
  color: var(--text-muted);
  font-weight: 500;
  position: sticky;
  top: 0;
  background: var(--surface);
}
summary {
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
summary::before {
  content: '▸ ';
}
details[open] > summary::before {
  content: '▾ ';
}
</style>
