<script setup lang="ts">
/**
 * Wraps every chart in a <figure> with a caption and a data-table fallback
 * (WCAG: the same information must be available without the graphic).
 */
import { ref, useId } from 'vue';

defineProps<{ title: string; caption?: string | undefined; compact?: boolean }>();

const showTable = ref(false);
const tableId = useId();
</script>

<template>
  <figure class="chart-frame" :class="compact ? 'text-xs' : 'text-sm'">
    <figcaption class="mb-2 flex items-baseline justify-between gap-3">
      <span>
        <span class="font-medium text-text">{{ title }}</span>
        <span v-if="caption" class="ml-2 text-subtle">{{ caption }}</span>
      </span>
      <button
        type="button"
        class="shrink-0 text-xs text-muted underline-offset-2 hover:text-text hover:underline"
        :aria-expanded="showTable"
        :aria-controls="tableId"
        @click="showTable = !showTable"
      >
        {{ showTable ? 'Hide table' : 'Table' }}
      </button>
    </figcaption>
    <div :aria-hidden="showTable ? 'true' : undefined">
      <slot />
    </div>
    <div v-show="showTable" :id="tableId" class="mt-2 max-h-56 overflow-auto rounded-sm border border-border">
      <slot name="table" />
    </div>
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
</style>
