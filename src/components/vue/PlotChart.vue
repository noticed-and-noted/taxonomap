<script setup lang="ts">
/**
 * Observable Plot chart (species pages, client:visible). The data table is
 * rendered at build time, so the information is there without JavaScript;
 * the chart itself draws in the browser, with tooltips, and redraws on resize
 * and theme change. Plot is loaded only when the chart scrolls into view.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { compact, full } from '~/lib/format';
import type { PlotBar } from '~/lib/species/charts';
import ChartFrame from './ChartFrame.vue';

const props = defineProps<{
  kind: 'years' | 'bars';
  title: string;
  caption?: string | undefined;
  /** kind = years: [year, count] ascending. */
  years?: readonly [number, number][];
  /** kind = bars: largest first. */
  bars?: readonly PlotBar[];
  total?: number;
}>();

const FROM = 1900;
const box = ref<HTMLDivElement>();
const drawn = ref(false);
const failed = ref(false);
let ro: ResizeObserver | undefined;
let mo: MutationObserver | undefined;
let lastWidth = 0;

const series = computed(() => {
  const ys = props.years ?? [];
  const first = ys.find(([y, c]) => y >= FROM && c > 0)?.[0] ?? FROM;
  const start = Math.max(FROM, Math.floor(first / 10) * 10);
  const end = new Date().getFullYear();
  const m = new Map(ys);
  return Array.from({ length: end - start + 1 }, (_, i) => ({ year: start + i, count: m.get(start + i) ?? 0 }));
});
const earlier = computed(() =>
  (props.years ?? []).reduce((s, [y, c]) => (y < (series.value[0]?.year ?? FROM) ? s + c : s), 0),
);
const decades = computed(() => {
  const out: [string, number][] = [];
  for (const { year, count } of series.value) {
    const d = `${Math.floor(year / 10) * 10}s`;
    const last = out[out.length - 1];
    if (last && last[0] === d) last[1] += count;
    else out.push([d, count]);
  }
  return out;
});
const peak = computed(() => series.value.reduce((p, s) => (s.count > p.count ? s : p), { year: 0, count: 0 }));
const caption = computed(
  () => props.caption ?? (props.kind === 'years' && peak.value.count ? `peak ${peak.value.year}` : undefined),
);
// Undated records only: an all-zero series breaks the y scale (NaN ticks).
const empty = computed(() => props.kind === 'years' && !peak.value.count);
const height = computed(() => (props.kind === 'years' ? 170 : (props.bars?.length ?? 0) * 26 + 34));

async function draw() {
  const el = box.value;
  if (!el || empty.value) return;
  const width = Math.round(el.clientWidth);
  if (!width || (drawn.value && width === lastWidth)) return;
  lastWidth = width;
  try {
    const Plot = await import('~/lib/plot');
    const style = { background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', overflow: 'visible' };
    let chart: Element;
    if (props.kind === 'years') {
      chart = Plot.plot({
        width,
        height: height.value,
        style,
        marginLeft: 44,
        x: { label: null, tickFormat: 'd', ticks: Math.max(3, Math.floor(width / 70)) },
        y: { label: 'Records', grid: true, tickFormat: '~s' },
        marks: [
          Plot.rectY(series.value, {
            x: 'year',
            y: 'count',
            interval: 1,
            fill: 'var(--ramp-4)',
            tip: { format: { x: 'd', y: (v: number) => full(v) } },
          }),
          Plot.ruleY([0], { stroke: 'var(--border)' }),
        ],
        ariaLabel: `${props.title}, peaking in ${peak.value.year}`,
      });
    } else {
      const bars = [...(props.bars ?? [])];
      const longest = Math.max(...bars.map((b) => b.label.length), 4);
      chart = Plot.plot({
        width,
        height: height.value,
        style,
        marginLeft: Math.min(180, Math.max(70, longest * 6.4)),
        marginRight: 48,
        x: { axis: null },
        y: { label: null, tickFormat: (l: string) => (l.length > 28 ? `${l.slice(0, 27)}…` : l) },
        marks: [
          Plot.barX(bars, {
            x: 'value',
            y: 'label',
            sort: { y: '-x' },
            fill: 'var(--ramp-4)',
            href: 'href',
            target: '_blank',
            tip: { format: { x: (v: number) => full(v), y: true } },
          }),
          Plot.text(bars, {
            x: 'value',
            y: 'label',
            text: (b: PlotBar) => compact(b.value),
            dx: 6,
            textAnchor: 'start',
            fill: 'var(--text-muted)',
          }),
        ],
        ariaLabel: props.title,
      });
    }
    el.replaceChildren(chart);
    drawn.value = true;
  } catch {
    failed.value = true;
  }
}

onMounted(() => {
  void draw();
  ro = new ResizeObserver(() => void draw());
  if (box.value) ro.observe(box.value);
  // Theme switch: CSS variables update by themselves, but redraw to be safe.
  mo = new MutationObserver(() => {
    lastWidth = 0;
    void draw();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});

onBeforeUnmount(() => {
  ro?.disconnect();
  mo?.disconnect();
});
</script>

<template>
  <ChartFrame :title="title" :caption="caption">
    <div ref="box" class="plot-box w-full" :style="{ minHeight: `${height}px` }">
      <p v-if="!drawn" class="grid place-items-center text-xs text-subtle" :style="{ height: `${height}px` }">
        {{
          empty
            ? 'None of these records has a year.'
            : failed
              ? 'The chart could not be drawn; the data table below has the same figures.'
              : 'Loading chart…'
        }}
      </p>
    </div>
    <p v-if="kind === 'years' && earlier" class="mt-1 text-xs text-subtle">
      Plus {{ full(earlier) }} records before {{ series[0]?.year }}.
    </p>
    <template v-if="!empty" #table>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ kind === 'years' ? 'Decade' : title }}</th>
            <th scope="col">Records</th>
          </tr>
        </thead>
        <tbody v-if="kind === 'years'">
          <tr v-for="[d, c] in decades" :key="d">
            <td>{{ d }}</td>
            <td>{{ full(c) }}</td>
          </tr>
        </tbody>
        <tbody v-else>
          <tr v-for="b in bars" :key="b.label">
            <td>
              <a
                v-if="b.href"
                :href="b.href"
                target="_blank"
                rel="noopener"
                class="underline-offset-2 hover:underline"
                >{{ b.label }}</a
              >
              <template v-else>{{ b.label }}</template>
            </td>
            <td>{{ full(b.value) }}</td>
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

<style scoped>
.plot-box :deep(svg) {
  max-width: 100%;
  height: auto;
}
.plot-box :deep([aria-label='tip'] path) {
  fill: var(--surface);
  stroke: var(--border-strong);
}
</style>
