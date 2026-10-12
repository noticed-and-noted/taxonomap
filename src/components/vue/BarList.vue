<script setup lang="ts">
/**
 * Horizontal bar list (top countries, top datasets). Plain HTML/CSS bars, so
 * it renders identically at build time and in the browser with no JS.
 */
import { computed } from 'vue';
import { compact, full } from '~/lib/format';
import ChartFrame from './ChartFrame.vue';

export interface BarItem {
  label: string;
  value: number;
  href?: string;
}

const props = defineProps<{ title: string; items: readonly BarItem[]; caption?: string; total?: number }>();

const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
</script>

<template>
  <ChartFrame :title="title" :caption="caption">
    <ol class="space-y-1.5" role="list">
      <li
        v-for="item in items"
        :key="item.label"
        class="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 text-sm"
      >
        <span class="truncate" :title="item.label">
          <a
            v-if="item.href"
            :href="item.href"
            class="underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener"
            >{{ item.label }}</a
          >
          <template v-else>{{ item.label }}</template>
        </span>
        <span class="h-2.5 overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
          <span
            class="block h-full rounded-sm bg-[var(--ramp-4)]"
            :style="{ width: `${(item.value / max) * 100}%` }"
          ></span>
        </span>
        <span class="text-right text-xs text-muted tabular-nums">{{ compact(item.value) }}</span>
      </li>
    </ol>
    <template #table>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ title }}</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="`t-${item.label}`">
            <td>{{ item.label }}</td>
            <td>{{ full(item.value) }}</td>
          </tr>
          <tr v-if="total !== undefined">
            <td>All</td>
            <td>{{ full(total) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>
