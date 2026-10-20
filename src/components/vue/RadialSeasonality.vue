<script setup lang="ts">
/**
 * Records per month as a radial bar chart (D3 arc + radial scale).
 * Area-true: radius ∝ √count. Data-table fallback via ChartFrame.
 */
import { arc } from 'd3-shape';
import { scaleRadial } from 'd3-scale';
import { computed } from 'vue';
import { full, MONTHS } from '~/lib/format';
import ChartFrame from './ChartFrame.vue';

const props = withDefaults(defineProps<{ counts: readonly number[]; size?: number; title?: string }>(), {
  size: 220,
  title: 'Seasonality',
});

const inner = computed(() => props.size * 0.16);
const outer = computed(() => props.size / 2 - 18);
const max = computed(() => Math.max(1, ...props.counts));
const total = computed(() => props.counts.reduce((sum, count) => sum + count, 0));
const peak = computed(() => props.counts.indexOf(Math.max(...props.counts)));

const wedges = computed(() => {
  const radius = scaleRadial().domain([0, max.value]).range([inner.value, outer.value]);
  const step = (2 * Math.PI) / 12;
  const arcGenerator = arc<{ index: number; count: number }>()
    .innerRadius(inner.value)
    .outerRadius((slice) => radius(slice.count))
    .startAngle((slice) => slice.index * step + 0.02)
    .endAngle((slice) => (slice.index + 1) * step - 0.02)
    .padAngle(0.01)
    .cornerRadius(2);
  return MONTHS.map((label, index) => {
    const count = props.counts[index] ?? 0;
    const middleAngle = (index + 0.5) * step;
    return {
      m: label,
      v: count,
      d: arcGenerator({ index, count }) ?? '',
      lx: Math.sin(middleAngle) * (outer.value + 10),
      ly: -Math.cos(middleAngle) * (outer.value + 10),
    };
  });
});
</script>

<template>
  <ChartFrame :title="title" :caption="total ? `peak in ${MONTHS[peak]}` : undefined" compact>
    <svg
      :viewBox="`${-size / 2} ${-size / 2} ${size} ${size}`"
      :width="size"
      :height="size"
      class="mx-auto block max-w-full"
      role="img"
      :aria-label="`Records by month. Peak in ${MONTHS[peak]}.`"
    >
      <circle :r="outer" fill="none" stroke="var(--border)" stroke-dasharray="2 3" />
      <circle :r="inner" fill="none" stroke="var(--border)" />
      <path
        v-for="(wedge, index) in wedges"
        :key="wedge.m"
        :d="wedge.d"
        :fill="index === peak ? 'var(--accent)' : 'var(--ramp-4)'"
        :fill-opacity="index === peak ? 1 : 0.75"
      >
        <title>{{ wedge.m }}: {{ full(wedge.v) }}</title>
      </path>
      <text
        v-for="wedge in wedges"
        :key="`l-${wedge.m}`"
        :x="wedge.lx"
        :y="wedge.ly"
        text-anchor="middle"
        dominant-baseline="middle"
        class="fill-[var(--text-subtle)] text-[11px]"
      >
        {{ wedge.m[0] }}
      </text>
    </svg>
    <template #table>
      <table>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="wedge in wedges" :key="`t-${wedge.m}`">
            <td>{{ wedge.m }}</td>
            <td>{{ full(wedge.v) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>
