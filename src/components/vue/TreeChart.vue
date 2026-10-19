<script setup lang="ts">
/**
 * Zoomable sunburst / icicle over the tree model (d3-hierarchy partition).
 * Shows the focus node plus three levels. Zooming tweens a "focus window"
 * (x-range and depth), so every arc moves consistently; honours reduced
 * motion. Hover shows a tooltip from data already loaded (no fetching).
 */
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc } from 'd3-shape';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { compact, full, RANK_LABELS } from '~/lib/format';
import type { TreeNode } from '~/lib/tree/model';
import UiIcon from './UiIcon.vue';

const props = defineProps<{
  root: TreeNode;
  focus: TreeNode;
  /** Bumped whenever the (non-reactive) tree is mutated. */
  version: number;
  metric: 'records' | 'species';
  layout: 'sunburst' | 'icicle';
  selectedKey: number | null;
  loadingKey: number | null;
}>();

const emit = defineEmits<{ pick: [node: TreeNode]; up: [] }>();

type HNode = HierarchyRectangularNode<TreeNode>;
const LEVELS = 3;

/** Okabe–Ito, colour-blind safe, one hue per kingdom. */
const KINGDOM_COLOURS: Record<string, string> = {
  Animalia: '#E69F00',
  Plantae: '#009E73',
  Fungi: '#CC79A7',
  Chromista: '#56B4E9',
  Bacteria: '#0072B2',
  Protozoa: '#D55E00',
  Archaea: '#F0E442',
  Viruses: '#999999',
};
const colourOf = (n: TreeNode) => KINGDOM_COLOURS[n.kingdom] ?? '#8a9a90';

const box = ref<HTMLDivElement>();
const width = ref(600);
const height = ref(600);
let ro: ResizeObserver | undefined;

onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    if (!e) return;
    width.value = Math.max(240, e.contentRect.width);
    height.value = Math.max(240, e.contentRect.height);
  });
  if (box.value) ro.observe(box.value);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  cancelAnimationFrame(raf);
});

const value = (n: TreeNode) => Math.max(0, props.metric === 'records' ? n.records : n.species);

/** Partition of the whole loaded tree: x in [0,1], y in depth units. */
const layoutRoot = computed(() => {
  void props.version;
  const h = hierarchy<TreeNode>(props.root, (d) => d.children)
    .sum((d) => (d.children?.length ? 0 : value(d)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return partition<TreeNode>().size([1, h.height + 1])(h);
});

const byKey = computed(() => {
  const m = new Map<number, HNode>();
  layoutRoot.value.each((n) => m.set(n.data.key, n));
  return m;
});

/* ---- focus window, tweened ---- */
const win = shallowRef({ x0: 0, x1: 1, d: 0 });
let raf = 0;

function targetFor(focus: TreeNode) {
  const n = byKey.value.get(focus.key);
  return n ? { x0: n.x0, x1: n.x1, d: n.depth } : { x0: 0, x1: 1, d: 0 };
}

function animateTo(t: { x0: number; x1: number; d: number }) {
  cancelAnimationFrame(raf);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = win.value;
  if (reduce) {
    win.value = t;
    return;
  }
  const start = performance.now();
  const dur = 650;
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const step = (now: number) => {
    const k = ease(Math.min(1, (now - start) / dur));
    win.value = {
      x0: from.x0 + (t.x0 - from.x0) * k,
      x1: from.x1 + (t.x1 - from.x1) * k,
      d: from.d + (t.d - from.d) * k,
    };
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

watch(
  () => [props.focus.key, props.version, props.metric] as const,
  (_, old) => {
    const t = targetFor(props.focus);
    // Data changes (not focus changes) snap without animation.
    if (old && old[0] === props.focus.key) win.value = t;
    else animateTo(t);
  },
  { immediate: true },
);

/* ---- visible geometry ---- */
interface Shape {
  node: TreeNode;
  rel: number;
  x0: number;
  x1: number;
  value: number;
}

const shapes = computed<Shape[]>(() => {
  const { x0: fx0, x1: fx1, d: fd } = win.value;
  const span = Math.max(1e-9, fx1 - fx0);
  const out: Shape[] = [];
  layoutRoot.value.each((n) => {
    const rel = n.depth - fd;
    if (rel < 0.5 || rel > LEVELS + 0.5) return;
    const x0 = Math.max(0, Math.min(1, (n.x0 - fx0) / span));
    const x1 = Math.max(0, Math.min(1, (n.x1 - fx0) / span));
    if (x1 - x0 < 0.0015) return;
    out.push({ node: n.data, rel, x0, x1, value: n.value ?? 0 });
  });
  return out;
});

/* sunburst */
const size = computed(() => Math.min(width.value, height.value));
const ring = computed(() => size.value / 2 / (LEVELS + 1));
const arcGen = arc<Shape>()
  .startAngle((s) => s.x0 * 2 * Math.PI)
  .endAngle((s) => s.x1 * 2 * Math.PI)
  .padAngle((s) => Math.min((s.x1 - s.x0) * Math.PI, 0.004))
  .padRadius(() => ring.value * 1.5)
  .innerRadius((s) => s.rel * ring.value)
  .outerRadius((s) => Math.max(s.rel * ring.value, (s.rel + 1) * ring.value - 1.5));

function sunLabel(s: Shape) {
  const mid = ((s.x0 + s.x1) / 2) * 360;
  const r = (s.rel + 0.5) * ring.value;
  const arcLen = (s.x1 - s.x0) * 2 * Math.PI * r;
  if (arcLen < 18 || s.rel > LEVELS) return null;
  const rot = mid - 90;
  const flip = mid > 180;
  const maxChars = Math.floor((ring.value - 8) / 6.2);
  const text = labelText(s.node);
  return {
    transform: `rotate(${rot}) translate(${r},0) rotate(${flip ? 180 : 0})`,
    text: text.length > maxChars ? `${text.slice(0, Math.max(3, maxChars - 1))}…` : text,
  };
}

/* icicle: columns by depth, focus in the first column (a header row when narrow) */
const narrow = computed(() => width.value < 520);
const HEAD = 44;
const top = computed(() => (narrow.value ? HEAD : 0));
const colW = computed(() => width.value / (narrow.value ? LEVELS : LEVELS + 1));
function rect(s: Shape) {
  const h = height.value - top.value;
  return {
    x: (narrow.value ? s.rel - 1 : s.rel) * colW.value,
    y: top.value + s.x0 * h,
    w: Math.max(0, colW.value - 2),
    h: Math.max(0, (s.x1 - s.x0) * h - 1),
  };
}

const labelText = (n: TreeNode) => n.common ?? n.name;

/* tooltip */
const tip = ref<{ x: number; y: number; node: TreeNode; value: number } | null>(null);
function onMove(e: PointerEvent, s: Shape) {
  if (e.pointerType === 'touch') return;
  const b = box.value?.getBoundingClientRect();
  if (!b) return;
  tip.value = { x: e.clientX - b.left, y: e.clientY - b.top, node: s.node, value: s.value };
}

const focusTotal = computed(() => byKey.value.get(props.focus.key)?.value ?? 0);
const opacity = (s: Shape) => (s.node.key === props.selectedKey ? 1 : 0.95 - (s.rel - 1) * 0.22);
const centreLabel = computed(() => props.focus.common ?? props.focus.name);
</script>

<template>
  <div ref="box" class="tree-chart relative size-full select-none" @pointerleave="tip = null">
    <svg
      v-if="layout === 'sunburst'"
      :width="width"
      :height="height"
      class="absolute inset-0"
      role="img"
      :aria-label="`Sunburst of ${centreLabel}, sized by ${metric}. Use the list beside the chart to navigate.`"
    >
      <g :transform="`translate(${width / 2},${height / 2})`">
        <path
          v-for="s in shapes"
          :key="s.node.key"
          :d="arcGen(s) ?? ''"
          :fill="colourOf(s.node)"
          :fill-opacity="opacity(s)"
          :stroke="s.node.key === selectedKey ? 'var(--accent)' : 'var(--bg)'"
          :stroke-width="s.node.key === selectedKey ? 2.5 : 0.5"
          :class="{ 'animate-pulse': s.node.key === loadingKey }"
          class="cursor-pointer"
          @pointermove="onMove($event, s)"
          @click="emit('pick', s.node)"
        />
        <g class="pointer-events-none" fill="var(--bg)">
          <template v-for="s in shapes" :key="`l-${s.node.key}`">
            <text
              v-if="sunLabel(s)"
              :transform="sunLabel(s)!.transform"
              text-anchor="middle"
              dominant-baseline="middle"
              class="text-[10.5px] font-medium"
            >
              {{ sunLabel(s)!.text }}
            </text>
          </template>
        </g>
        <circle :r="ring - 2" fill="var(--surface)" stroke="var(--border)" class="cursor-pointer" @click="emit('up')" />
        <text text-anchor="middle" class="pointer-events-none fill-[var(--text)] font-display text-sm" y="-6">
          {{ centreLabel.length > 18 ? `${centreLabel.slice(0, 17)}…` : centreLabel }}
        </text>
        <text text-anchor="middle" class="pointer-events-none fill-[var(--text-subtle)] text-[11px]" y="12">
          {{ compact(focusTotal) }} {{ metric }}
        </text>
        <g v-if="focus.parent" class="pointer-events-none text-[var(--text-subtle)]">
          <UiIcon name="arrow-up" :size="10" x="-27" y="20" />
          <text text-anchor="middle" class="fill-current text-[10px]" x="6" y="28">zoom out</text>
        </g>
      </g>
    </svg>

    <svg
      v-else
      :width="width"
      :height="height"
      class="absolute inset-0"
      role="img"
      :aria-label="`Icicle chart of ${centreLabel}, sized by ${metric}. Use the list beside the chart to navigate.`"
    >
      <g v-if="narrow" class="cursor-pointer" @click="emit('up')">
        <rect :width="width - 2" :height="HEAD - 4" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
        <UiIcon v-if="focus.parent" name="arrow-left" :size="12" x="10" y="15" class="text-[var(--text)]" />
        <text :x="focus.parent ? 26 : 10" :y="25" class="fill-[var(--text)] font-display text-sm">
          {{ centreLabel.length > 22 ? `${centreLabel.slice(0, 21)}…` : centreLabel }}
        </text>
        <text :x="width - 10" :y="25" text-anchor="end" class="fill-[var(--text-subtle)] text-[11px]">
          {{ compact(focusTotal) }} {{ metric }}
        </text>
      </g>
      <g v-else class="cursor-pointer" @click="emit('up')">
        <rect :width="colW - 2" :height="height - 1" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
        <text :x="10" :y="20" class="fill-[var(--text)] font-display text-sm">{{ centreLabel }}</text>
        <text :x="10" :y="38" class="fill-[var(--text-subtle)] text-[11px]">
          {{ compact(focusTotal) }} {{ metric }}
        </text>
        <g v-if="focus.parent" class="text-[var(--text-subtle)]">
          <UiIcon name="arrow-left" :size="10" x="10" y="48" />
          <text :x="23" :y="56" class="fill-current text-[10px]">zoom out</text>
        </g>
      </g>
      <g
        v-for="s in shapes"
        :key="s.node.key"
        class="cursor-pointer"
        @pointermove="onMove($event, s)"
        @click="emit('pick', s.node)"
      >
        <rect
          :x="rect(s).x"
          :y="rect(s).y"
          :width="rect(s).w"
          :height="rect(s).h"
          rx="2"
          :fill="colourOf(s.node)"
          :fill-opacity="opacity(s)"
          :stroke="s.node.key === selectedKey ? 'var(--accent)' : 'none'"
          stroke-width="2.5"
          :class="{ 'animate-pulse': s.node.key === loadingKey }"
        />
        <text
          v-if="rect(s).h > 15 && rect(s).w > 30"
          :x="rect(s).x + 6"
          :y="rect(s).y + 13"
          class="pointer-events-none text-[10.5px] font-medium"
          fill="var(--bg)"
        >
          {{
            labelText(s.node).length > colW / 6.5
              ? `${labelText(s.node).slice(0, Math.floor(colW / 6.5) - 1)}…`
              : labelText(s.node)
          }}
        </text>
      </g>
    </svg>

    <div
      v-if="tip"
      class="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-[115%] rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-panel"
      :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
    >
      <p v-if="tip.node.common" class="font-medium text-text">{{ tip.node.common }}</p>
      <p class="sci-name text-muted">{{ tip.node.name }}</p>
      <p class="mt-1 text-subtle">
        {{ RANK_LABELS[tip.node.rank] ?? tip.node.rank }} · {{ full(tip.value) }} {{ metric }}
        <span v-if="focusTotal"
          >({{ ((tip.value / focusTotal) * 100).toFixed(tip.value / focusTotal < 0.01 ? 2 : 1) }}%)</span
        >
      </p>
    </div>
  </div>
</template>
