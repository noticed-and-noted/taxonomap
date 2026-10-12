<script setup lang="ts">
/** Records per year as SVG bars with a light axis; static, no JS needed. */
import { computed } from 'vue';
import { compact, full } from '~/lib/format';
import ChartFrame from './ChartFrame.vue';

const props = withDefaults(defineProps<{ years: readonly [number, number][]; from?: number; title?: string }>(), {
  from: 1900,
  title: 'Records per year',
});

const W = 640;
const H = 140;
const PAD_L = 36;
const PAD_B = 18;
const to = new Date().getFullYear();

const domain = computed(() => {
  const first = props.years.find(([y, c]) => y >= props.from && c > 0)?.[0] ?? props.from;
  // Start at the decade of the first record (but not before `from`).
  return [Math.max(props.from, Math.floor(first / 10) * 10), to] as const;
});
const series = computed(() => {
  const m = new Map(props.years);
  const [a, b] = domain.value;
  return Array.from({ length: b - a + 1 }, (_, i) => [a + i, m.get(a + i) ?? 0] as [number, number]);
});
const max = computed(() => Math.max(1, ...series.value.map(([, c]) => c)));
const earlier = computed(() => props.years.reduce((s, [y, c]) => (y < domain.value[0] ? s + c : s), 0));
const bw = computed(() => (W - PAD_L) / series.value.length);
const ticks = computed(() => {
  const [a, b] = domain.value;
  const span = b - a;
  const step = span > 80 ? 20 : span > 40 ? 10 : 5;
  const out: number[] = [];
  for (let y = Math.ceil(a / step) * step; y <= b; y += step) out.push(y);
  return out;
});
const peak = computed(() => series.value.reduce((p, s) => (s[1] > p[1] ? s : p), [0, 0] as [number, number]));
const decades = computed(() => {
  const out: [string, number][] = [];
  for (const [y, c] of series.value) {
    const d = `${Math.floor(y / 10) * 10}s`;
    const last = out[out.length - 1];
    if (last && last[0] === d) last[1] += c;
    else out.push([d, c]);
  }
  return out;
});
const x = (y: number) => PAD_L + (y - domain.value[0]) * bw.value;
</script>

<template>
  <ChartFrame :title="title" :caption="peak[1] ? `peak ${peak[0]}` : undefined">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="block h-auto w-full"
      role="img"
      :aria-label="`Records per year from ${domain[0]} to ${domain[1]}, peaking in ${peak[0]}`"
    >
      <g class="text-[10px]" fill="var(--text-subtle)">
        <text :x="PAD_L - 6" :y="10" text-anchor="end">{{ compact(max) }}</text>
        <text :x="PAD_L - 6" :y="H - PAD_B" text-anchor="end">0</text>
        <text v-for="t in ticks" :key="t" :x="x(t) + bw / 2" :y="H - 4" text-anchor="middle">{{ t }}</text>
      </g>
      <line :x1="PAD_L" :x2="W" :y1="H - PAD_B" :y2="H - PAD_B" stroke="var(--border)" />
      <rect
        v-for="[y, c] in series"
        :key="y"
        :x="x(y)"
        :y="H - PAD_B - (c / max) * (H - PAD_B - 8)"
        :width="Math.max(bw - 0.8, 0.8)"
        :height="(c / max) * (H - PAD_B - 8)"
        fill="var(--ramp-4)"
      >
        <title>{{ y }}: {{ full(c) }}</title>
      </rect>
    </svg>
    <p v-if="earlier" class="mt-1 text-xs text-subtle">Plus {{ full(earlier) }} records before {{ domain[0] }}.</p>
    <template #table>
      <table>
        <thead>
          <tr>
            <th scope="col">Decade</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[d, c] in decades" :key="d">
            <td>{{ d }}</td>
            <td>{{ full(c) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>
