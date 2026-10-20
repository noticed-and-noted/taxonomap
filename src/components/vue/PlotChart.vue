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
const BAR_ROW_HEIGHT = 26;
const BAR_CHART_PADDING = 34;
const box = ref<HTMLDivElement>();
const drawn = ref(false);
const failed = ref(false);
let resizeObserver: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
let lastWidth = 0;

const series = computed(() => {
  const ys = props.years ?? [];
  const first = ys.find(([year, count]) => year >= FROM && count > 0)?.[0] ?? FROM;
  const start = Math.max(FROM, Math.floor(first / 10) * 10);
  const end = new Date().getFullYear();
  const countByYear = new Map(ys);
  return Array.from({ length: end - start + 1 }, (_unused, offset) => ({
    year: start + offset,
    count: countByYear.get(start + offset) ?? 0,
  }));
});
const earlier = computed(() =>
  (props.years ?? []).reduce(
    (total, [year, count]) => (year < (series.value[0]?.year ?? FROM) ? total + count : total),
    0,
  ),
);
const decades = computed(() => {
  const out: [string, number][] = [];
  for (const { year, count } of series.value) {
    const decade = `${Math.floor(year / 10) * 10}s`;
    const last = out[out.length - 1];
    if (last && last[0] === decade) last[1] += count;
    else out.push([decade, count]);
  }
  return out;
});
const peak = computed(() =>
  series.value.reduce((best, bar) => (bar.count > best.count ? bar : best), { year: 0, count: 0 }),
);
const caption = computed(
  () => props.caption ?? (props.kind === 'years' && peak.value.count ? `peak ${peak.value.year}` : undefined),
);
// Undated records only: an all-zero series breaks the y scale (NaN ticks).
const empty = computed(() => props.kind === 'years' && !peak.value.count);
const height = computed(() =>
  props.kind === 'years' ? 170 : (props.bars?.length ?? 0) * BAR_ROW_HEIGHT + BAR_CHART_PADDING,
);

type PlotModule = typeof import('~/lib/plot');

const MIN_YEAR_TICKS = 3;
const PX_PER_YEAR_TICK = 70;
const MAX_BAR_LABEL_CHARS = 28;
const BAR_LABEL_PX_PER_CHAR = 6.4;
const PLOT_STYLE = { background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', overflow: 'visible' };

/** Records-per-year histogram. */
function yearsChart(Plot: PlotModule, width: number): Element {
  return Plot.plot({
    width,
    height: height.value,
    style: PLOT_STYLE,
    marginLeft: 44,
    x: { label: null, tickFormat: 'd', ticks: Math.max(MIN_YEAR_TICKS, Math.floor(width / PX_PER_YEAR_TICK)) },
    y: { label: 'Records', grid: true, tickFormat: '~s' },
    marks: [
      Plot.rectY(series.value, {
        x: 'year',
        y: 'count',
        interval: 1,
        fill: 'var(--ramp-4)',
        tip: { format: { x: 'd', y: (value: number) => full(value) } },
      }),
      Plot.ruleY([0], { stroke: 'var(--border)' }),
    ],
    ariaLabel: `${props.title}, peaking in ${peak.value.year}`,
  });
}

/** Horizontal bars with the count after each; labels link out where the data has an href. */
function barsChart(Plot: PlotModule, width: number): Element {
  const bars = [...(props.bars ?? [])];
  const longest = Math.max(...bars.map((bar) => bar.label.length), 4);
  const truncate = (label: string) =>
    label.length > MAX_BAR_LABEL_CHARS ? `${label.slice(0, MAX_BAR_LABEL_CHARS - 1)}…` : label;
  return Plot.plot({
    width,
    height: height.value,
    style: PLOT_STYLE,
    marginLeft: Math.min(180, Math.max(70, longest * BAR_LABEL_PX_PER_CHAR)),
    marginRight: 48,
    x: { axis: null },
    y: { label: null, tickFormat: truncate },
    marks: [
      Plot.barX(bars, {
        x: 'value',
        y: 'label',
        sort: { y: '-x' },
        fill: 'var(--ramp-4)',
        href: 'href',
        target: '_blank',
        tip: { format: { x: (value: number) => full(value), y: true } },
      }),
      Plot.text(bars, {
        x: 'value',
        y: 'label',
        text: (bar: PlotBar) => compact(bar.value),
        dx: 6,
        textAnchor: 'start',
        fill: 'var(--text-muted)',
      }),
    ],
    ariaLabel: props.title,
  });
}

async function draw() {
  const element = box.value;
  if (!element || empty.value) return;
  const width = Math.round(element.clientWidth);
  if (!width || (drawn.value && width === lastWidth)) return;
  lastWidth = width;
  try {
    const Plot = await import('~/lib/plot');
    element.replaceChildren(props.kind === 'years' ? yearsChart(Plot, width) : barsChart(Plot, width));
    drawn.value = true;
  } catch {
    failed.value = true;
  }
}

onMounted(() => {
  void draw();
  resizeObserver = new ResizeObserver(() => void draw());
  if (box.value) resizeObserver.observe(box.value);
  // Theme switch: CSS variables update by themselves, but redraw to be safe.
  themeObserver = new MutationObserver(() => {
    lastWidth = 0;
    void draw();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
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
          <tr v-for="[decade, count] in decades" :key="decade">
            <td>{{ decade }}</td>
            <td>{{ full(count) }}</td>
          </tr>
        </tbody>
        <tbody v-else>
          <tr v-for="bar in bars" :key="bar.label">
            <td>
              <a
                v-if="bar.href"
                :href="bar.href"
                target="_blank"
                rel="noopener"
                class="underline-offset-2 hover:underline"
                >{{ bar.label }}</a
              >
              <template v-else>{{ bar.label }}</template>
            </td>
            <td>{{ full(bar.value) }}</td>
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
