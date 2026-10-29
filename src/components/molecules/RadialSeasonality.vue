<script setup lang="ts">
/**
 * Records per month as a radial bar chart (D3 arc + radial scale).
 * Area-true: radius ∝ √count. Data-table fallback via ChartFrame.
 */
import { scaleRadial } from 'd3-scale';
import { arc } from 'd3-shape';
import { computed, ref } from 'vue';
import ChartTip from '~/components/atoms/ChartTip.vue';
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

const MONTH_ANGLE = (2 * Math.PI) / 12;

const wedges = computed(() => {
  const radius = scaleRadial().domain([0, max.value]).range([inner.value, outer.value]);
  const arcGenerator = arc<{ index: number; count: number }>()
    .innerRadius(inner.value)
    .outerRadius((slice) => radius(slice.count))
    .startAngle((slice) => slice.index * MONTH_ANGLE + 0.02)
    .endAngle((slice) => (slice.index + 1) * MONTH_ANGLE - 0.02)
    .padAngle(0.01)
    .cornerRadius(2);
  return MONTHS.map((label, index) => {
    const count = props.counts[index] ?? 0;
    const middleAngle = (index + 0.5) * MONTH_ANGLE;
    return {
      m: label,
      v: count,
      d: arcGenerator({ index, count }) ?? '',
      lx: Math.sin(middleAngle) * (outer.value + 10),
      ly: -Math.cos(middleAngle) * (outer.value + 10),
    };
  });
});

// Touch fires pointerleave as the finger lifts; keep the tapped month's tip until ChartTip dismisses it.
const onLeave = (event: PointerEvent) => event.pointerType !== 'touch' && (hover.value = null);

// By angle rather than per wedge, so short (or empty) months are as easy to hover as the peak.
const hover = ref<{ x: number; y: number; index: number } | null>(null);
function onHover(event: PointerEvent) {
  const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
  const scale = box.width / props.size;
  const dx = (event.clientX - box.left) / scale - props.size / 2;
  const dy = (event.clientY - box.top) / scale - props.size / 2;
  if (Math.hypot(dx, dy) > outer.value) {
    hover.value = null;
    return;
  }
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  hover.value = { x: event.clientX, y: event.clientY, index: Math.floor(angle / MONTH_ANGLE) % MONTHS.length };
}
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
      @pointerdown="onHover"
      @pointermove="onHover"
      @pointerleave="onLeave"
    >
      <circle :r="outer" fill="none" stroke="var(--border)" stroke-dasharray="2 3" />
      <circle :r="inner" fill="none" stroke="var(--border)" />
      <path
        v-for="(wedge, index) in wedges"
        :key="wedge.m"
        :d="wedge.d"
        :fill="index === peak ? 'var(--accent)' : 'var(--ramp-4)'"
        :fill-opacity="index === peak || index === hover?.index ? 1 : 0.75"
      />
      <text
        v-for="wedge in wedges"
        :key="`l-${wedge.m}`"
        :x="wedge.lx"
        :y="wedge.ly"
        text-anchor="middle"
        dominant-baseline="middle"
        class="fill-[var(--text-subtle)] text-[0.6875rem]"
      >
        {{ wedge.m[0] }}
      </text>
    </svg>
    <ChartTip v-if="hover" :x="hover.x" :y="hover.y" class="whitespace-nowrap" @dismiss="hover = null">
      <span class="font-medium text-text">{{ MONTHS[hover.index] }}</span>
      <span class="text-subtle"> · {{ full(counts[hover.index] ?? 0) }} records</span>
    </ChartTip>
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
