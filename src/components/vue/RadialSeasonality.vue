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
const total = computed(() => props.counts.reduce((a, b) => a + b, 0));
const peak = computed(() => props.counts.indexOf(Math.max(...props.counts)));

const wedges = computed(() => {
  const r = scaleRadial().domain([0, max.value]).range([inner.value, outer.value]);
  const step = (2 * Math.PI) / 12;
  const gen = arc<{ i: number; v: number }>()
    .innerRadius(inner.value)
    .outerRadius((d) => r(d.v))
    .startAngle((d) => d.i * step + 0.02)
    .endAngle((d) => (d.i + 1) * step - 0.02)
    .padAngle(0.01)
    .cornerRadius(2);
  return MONTHS.map((m, i) => {
    const v = props.counts[i] ?? 0;
    const mid = (i + 0.5) * step;
    return {
      m,
      v,
      d: gen({ i, v }) ?? '',
      lx: Math.sin(mid) * (outer.value + 10),
      ly: -Math.cos(mid) * (outer.value + 10),
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
        v-for="(w, i) in wedges"
        :key="w.m"
        :d="w.d"
        :fill="i === peak ? 'var(--accent)' : 'var(--ramp-4)'"
        :fill-opacity="i === peak ? 1 : 0.75"
      >
        <title>{{ w.m }}: {{ full(w.v) }}</title>
      </path>
      <text
        v-for="w in wedges"
        :key="`l-${w.m}`"
        :x="w.lx"
        :y="w.ly"
        text-anchor="middle"
        dominant-baseline="middle"
        class="fill-[var(--text-subtle)] text-[11px]"
      >
        {{ w.m[0] }}
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
          <tr v-for="w in wedges" :key="`t-${w.m}`">
            <td>{{ w.m }}</td>
            <td>{{ full(w.v) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>
