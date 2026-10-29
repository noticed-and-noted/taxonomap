<script setup lang="ts">
/** The phone Filters sheet's tabs: one per filter group, as on the desktop rail, plus the map settings. */
import { useStore } from '@nanostores/vue';
import { $groupCounts, FILTER_GROUPS, SETTINGS, type FilterGroupId } from '~/lib/filter-groups';

const tab = defineModel<FilterGroupId | 'settings'>({ required: true });

const groupCounts = useStore($groupCounts);
const TABS = [...FILTER_GROUPS, { ...SETTINGS, label: 'Map' }];
</script>

<template>
  <div role="tablist" aria-label="Filter groups" class="flex border-b border-border">
    <button
      v-for="option in TABS"
      :key="option.id"
      role="tab"
      type="button"
      :aria-selected="tab === option.id"
      class="-mb-px flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-1.5 text-xs"
      :class="tab === option.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
      @click="tab = option.id"
    >
      <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
        <path :d="option.icon" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>
        {{ option.label
        }}<span v-if="option.id !== 'settings' && groupCounts[option.id]" class="tabular-nums">
          ({{ groupCounts[option.id] }})</span
        >
      </span>
    </button>
  </div>
</template>
