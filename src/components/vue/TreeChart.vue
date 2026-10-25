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
import { prefersReducedMotion } from '~/stores/reading';
import ChartTip from './ChartTip.vue';
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
const colourOf = (node: TreeNode) => KINGDOM_COLOURS[node.kingdom] ?? '#8a9a90';

const box = ref<HTMLDivElement>();
const width = ref(600);
const height = ref(600);
let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    width.value = Math.max(240, entry.contentRect.width);
    height.value = Math.max(240, entry.contentRect.height);
  });
  if (box.value) resizeObserver.observe(box.value);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(animationFrameId);
});

const value = (node: TreeNode) => Math.max(0, props.metric === 'records' ? node.records : node.species);

/** Partition of the whole loaded tree: x in [0,1], y in depth units. */
const layoutRoot = computed(() => {
  void props.version;
  const tree = hierarchy<TreeNode>(props.root, (node) => node.children)
    .sum((node) => (node.children?.length ? 0 : value(node)))
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
  return partition<TreeNode>().size([1, tree.height + 1])(tree);
});

const byKey = computed(() => {
  const lookup = new Map<number, HNode>();
  layoutRoot.value.each((node) => lookup.set(node.data.key, node));
  return lookup;
});

/* ---- focus window, tweened ---- */
const viewWindow = shallowRef({ x0: 0, x1: 1, depth: 0 });
let animationFrameId = 0;

function targetFor(focus: TreeNode) {
  const node = byKey.value.get(focus.key);
  return node ? { x0: node.x0, x1: node.x1, depth: node.depth } : { x0: 0, x1: 1, depth: 0 };
}

function animateTo(target: { x0: number; x1: number; depth: number }) {
  cancelAnimationFrame(animationFrameId);
  const reduce = prefersReducedMotion();
  const from = viewWindow.value;
  if (reduce) {
    viewWindow.value = target;
    return;
  }
  const start = performance.now();
  const durationMs = 650;
  const ease = (progress: number) =>
    progress < 0.5 ? 4 * progress * progress * progress : 1 - (-2 * progress + 2) ** 3 / 2;
  const step = (now: number) => {
    const eased = ease(Math.min(1, (now - start) / durationMs));
    viewWindow.value = {
      x0: from.x0 + (target.x0 - from.x0) * eased,
      x1: from.x1 + (target.x1 - from.x1) * eased,
      depth: from.depth + (target.depth - from.depth) * eased,
    };
    if (eased < 1) animationFrameId = requestAnimationFrame(step);
  };
  animationFrameId = requestAnimationFrame(step);
}

watch(
  () => [props.focus.key, props.version, props.metric] as const,
  (_unused, previous) => {
    const target = targetFor(props.focus);
    // Data changes (not focus changes) snap without animation.
    if (previous && previous[0] === props.focus.key) viewWindow.value = target;
    else animateTo(target);
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
  const { x0: focusStart, x1: focusEnd, depth: focusDepth } = viewWindow.value;
  const span = Math.max(1e-9, focusEnd - focusStart);
  const out: Shape[] = [];
  layoutRoot.value.each((node) => {
    const relativeDepth = node.depth - focusDepth;
    if (relativeDepth < 0.5 || relativeDepth > LEVELS + 0.5) return;
    const x0 = Math.max(0, Math.min(1, (node.x0 - focusStart) / span));
    const x1 = Math.max(0, Math.min(1, (node.x1 - focusStart) / span));
    if (x1 - x0 < 0.0015) return;
    out.push({ node: node.data, rel: relativeDepth, x0, x1, value: node.value ?? 0 });
  });
  return out;
});

/* sunburst */
const size = computed(() => Math.min(width.value, height.value));
const ring = computed(() => size.value / 2 / (LEVELS + 1));
const arcGen = arc<Shape>()
  .startAngle((shape) => shape.x0 * 2 * Math.PI)
  .endAngle((shape) => shape.x1 * 2 * Math.PI)
  .padAngle((shape) => Math.min((shape.x1 - shape.x0) * Math.PI, 0.004))
  .padRadius(() => ring.value * 1.5)
  .innerRadius((shape) => shape.rel * ring.value)
  .outerRadius((shape) => Math.max(shape.rel * ring.value, (shape.rel + 1) * ring.value - 1.5));

function sunLabel(shape: Shape) {
  const midAngle = ((shape.x0 + shape.x1) / 2) * 360;
  const radius = (shape.rel + 0.5) * ring.value;
  const arcLen = (shape.x1 - shape.x0) * 2 * Math.PI * radius;
  if (arcLen < 18 || shape.rel > LEVELS) return null;
  const rotation = midAngle - 90;
  const flip = midAngle > 180;
  const maxChars = Math.floor((ring.value - 8) / 6.2);
  const text = labelText(shape.node);
  return {
    transform: `rotate(${rotation}) translate(${radius},0) rotate(${flip ? 180 : 0})`,
    text: text.length > maxChars ? `${text.slice(0, Math.max(3, maxChars - 1))}…` : text,
  };
}

/* icicle: columns by depth, focus in the first column (a header row when narrow) */
const narrow = computed(() => width.value < 520);
const HEAD = 44;
const top = computed(() => (narrow.value ? HEAD : 0));
const columnWidth = computed(() => width.value / (narrow.value ? LEVELS : LEVELS + 1));
function rect(shape: Shape) {
  const availableHeight = height.value - top.value;
  return {
    x: (narrow.value ? shape.rel - 1 : shape.rel) * columnWidth.value,
    y: top.value + shape.x0 * availableHeight,
    w: Math.max(0, columnWidth.value - 2),
    h: Math.max(0, (shape.x1 - shape.x0) * availableHeight - 1),
  };
}

const labelText = (node: TreeNode) => node.common ?? node.name;

/* tooltip */
const tip = ref<{ x: number; y: number; node: TreeNode; value: number } | null>(null);
function onMove(event: PointerEvent, shape: Shape) {
  if (event.pointerType === 'touch') return;
  tip.value = { x: event.clientX, y: event.clientY, node: shape.node, value: shape.value };
}

const focusTotal = computed(() => byKey.value.get(props.focus.key)?.value ?? 0);
const opacity = (shape: Shape) => (shape.node.key === props.selectedKey ? 1 : 0.95 - (shape.rel - 1) * 0.22);
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
          v-for="shape in shapes"
          :key="shape.node.key"
          :d="arcGen(shape) ?? ''"
          :fill="colourOf(shape.node)"
          :fill-opacity="opacity(shape)"
          :stroke="shape.node.key === selectedKey ? 'var(--accent)' : 'var(--bg)'"
          :stroke-width="shape.node.key === selectedKey ? 2.5 : 0.5"
          :class="{ 'animate-pulse': shape.node.key === loadingKey }"
          class="cursor-pointer"
          @pointermove="onMove($event, shape)"
          @click="emit('pick', shape.node)"
        />
        <g class="pointer-events-none" fill="var(--bg)">
          <template v-for="shape in shapes" :key="`l-${shape.node.key}`">
            <text
              v-if="sunLabel(shape)"
              :transform="sunLabel(shape)!.transform"
              text-anchor="middle"
              dominant-baseline="middle"
              class="text-[0.65625rem] font-medium"
            >
              {{ sunLabel(shape)!.text }}
            </text>
          </template>
        </g>
        <circle
          :r="ring - 2"
          fill="var(--surface)"
          stroke="var(--border)"
          class="cursor-pointer"
          @pointerenter="tip = null"
          @click="emit('up')"
        />
        <text text-anchor="middle" class="pointer-events-none fill-[var(--text)] font-display text-sm" y="-6">
          {{ centreLabel.length > 18 ? `${centreLabel.slice(0, 17)}…` : centreLabel }}
        </text>
        <text text-anchor="middle" class="pointer-events-none fill-[var(--text-subtle)] text-xs" y="12">
          {{ compact(focusTotal) }} {{ metric }}
        </text>
        <g v-if="focus.parent" class="pointer-events-none text-[var(--text-subtle)]">
          <UiIcon name="arrow-up" :size="10" x="-33" y="20" />
          <text class="fill-current text-xs" x="-19" y="28">zoom out</text>
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
      <g v-if="narrow" class="cursor-pointer" @pointerenter="tip = null" @click="emit('up')">
        <rect :width="width - 2" :height="HEAD - 4" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
        <UiIcon v-if="focus.parent" name="arrow-left" :size="12" x="10" y="15" class="text-[var(--text)]" />
        <text :x="focus.parent ? 26 : 10" :y="25" class="fill-[var(--text)] font-display text-sm">
          {{ centreLabel.length > 22 ? `${centreLabel.slice(0, 21)}…` : centreLabel }}
        </text>
        <text :x="width - 10" :y="25" text-anchor="end" class="fill-[var(--text-subtle)] text-xs">
          {{ compact(focusTotal) }} {{ metric }}
        </text>
      </g>
      <g v-else class="cursor-pointer" @pointerenter="tip = null" @click="emit('up')">
        <rect :width="columnWidth - 2" :height="height - 1" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
        <text :x="10" :y="20" class="fill-[var(--text)] font-display text-sm">{{ centreLabel }}</text>
        <text :x="10" :y="38" class="fill-[var(--text-subtle)] text-xs">{{ compact(focusTotal) }} {{ metric }}</text>
        <g v-if="focus.parent" class="text-[var(--text-subtle)]">
          <UiIcon name="arrow-left" :size="10" x="10" y="48" />
          <text :x="23" :y="56" class="fill-current text-xs">zoom out</text>
        </g>
      </g>
      <g
        v-for="shape in shapes"
        :key="shape.node.key"
        class="cursor-pointer"
        @pointermove="onMove($event, shape)"
        @click="emit('pick', shape.node)"
      >
        <rect
          :x="rect(shape).x"
          :y="rect(shape).y"
          :width="rect(shape).w"
          :height="rect(shape).h"
          rx="2"
          :fill="colourOf(shape.node)"
          :fill-opacity="opacity(shape)"
          :stroke="shape.node.key === selectedKey ? 'var(--accent)' : 'none'"
          stroke-width="2.5"
          :class="{ 'animate-pulse': shape.node.key === loadingKey }"
        />
        <text
          v-if="rect(shape).h > 15 && rect(shape).w > 30"
          :x="rect(shape).x + 6"
          :y="rect(shape).y + 13"
          class="pointer-events-none text-[0.65625rem] font-medium"
          fill="var(--bg)"
        >
          {{
            labelText(shape.node).length > columnWidth / 6.5
              ? `${labelText(shape.node).slice(0, Math.floor(columnWidth / 6.5) - 1)}…`
              : labelText(shape.node)
          }}
        </text>
      </g>
    </svg>

    <ChartTip v-if="tip" :x="tip.x" :y="tip.y" @dismiss="tip = null">
      <p v-if="tip.node.common" class="font-medium text-text">{{ tip.node.common }}</p>
      <p class="sci-name text-muted">{{ tip.node.name }}</p>
      <p class="mt-1 text-subtle">
        {{ RANK_LABELS[tip.node.rank] ?? tip.node.rank }} · {{ full(tip.value) }} {{ metric }}
        <span v-if="focusTotal"
          >({{ ((tip.value / focusTotal) * 100).toFixed(tip.value / focusTotal < 0.01 ? 2 : 1) }}%)</span
        >
      </p>
    </ChartTip>
  </div>
</template>
