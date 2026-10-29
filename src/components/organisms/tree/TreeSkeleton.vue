<script setup lang="ts">
/**
 * Loading stand-in for TreeChart: a made-up partition drawn in the chart's
 * own shape, with a shimmer that sweeps clockwise round the sunburst and
 * top to bottom down each icicle column.
 */
import { arc } from 'd3-shape';

const props = defineProps<{ layout: 'sunburst' | 'icicle'; narrow: boolean }>();

/** One made-up node: its depth below the focus, and its share of the circle or column (0 to 1). */
type Ghost = { depth: number; x0: number; x1: number };

const LEVELS = 3;
const VIEW = 400;
const RING = VIEW / 2 / (LEVELS + 1);
const SWEEP_SECONDS = 1.8;
const SWEEP_DURATION = `${SWEEP_SECONDS}s`;
/** How far each icicle column lags the one before, as a share of the sweep. */
const COLUMN_LAG = 0.15;
const HEAD = 44;
/** Gaps, in viewBox units, between neighbouring rings, cells and the narrow icicle's header. */
const RING_GAP = 3;
const CELL_GAP = 2;
const HEAD_GAP = 6;
/** Angle, in radians, between neighbouring arcs, measured at PAD_RADIUS. */
const PAD_ANGLE = 0.012;
const PAD_RADIUS = RING * 1.5;

/** Branch weights per level: each entry splits its parent into those shares. */
const BRANCHES: number[][] = [
  [3, 2, 2, 1],
  [2, 1, 1, 1, 1, 2, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];
const CHILD_COUNTS: number[][] = [[4], [2, 3, 2, 1], [3, 2, 2, 2, 3, 2, 2, 2]];

function splitLevel(parents: Ghost[], weights: number[], counts: number[], depth: number): Ghost[] {
  const children: Ghost[] = [];
  let next = 0;
  parents.forEach((parent, parentIndex) => {
    const shares = weights.slice(next, next + (counts[parentIndex] ?? 1));
    next += shares.length;
    const total = shares.reduce((sum, share) => sum + share, 0);
    let start = parent.x0;
    for (const share of shares) {
      const end = start + ((parent.x1 - parent.x0) * share) / total;
      children.push({ depth, x0: start, x1: end });
      start = end;
    }
  });
  return children;
}

const ghosts: Ghost[] = [];
let level: Ghost[] = [{ depth: 0, x0: 0, x1: 1 }];
for (let depth = 0; depth < LEVELS; depth++) {
  level = splitLevel(level, BRANCHES[depth] ?? [], CHILD_COUNTS[depth] ?? [], depth + 1);
  ghosts.push(...level);
}

const arcPath = arc<Ghost>()
  .startAngle((ghost) => ghost.x0 * 2 * Math.PI)
  .endAngle((ghost) => ghost.x1 * 2 * Math.PI)
  .padAngle(PAD_ANGLE)
  .padRadius(PAD_RADIUS)
  .innerRadius((ghost) => ghost.depth * RING)
  .outerRadius((ghost) => (ghost.depth + 1) * RING - RING_GAP);

const delay = (seconds: number) => ({ animationDelay: `${(seconds * SWEEP_SECONDS).toFixed(2)}s` });
const sunDelay = (ghost: Ghost) => delay(ghost.x0);
const iceDelay = (ghost: Ghost) => delay(ghost.x0 + ghost.depth * COLUMN_LAG);

const top = () => (props.narrow ? HEAD : 0);
const columnWidth = () => VIEW / (props.narrow ? LEVELS : LEVELS + 1);
function rect(ghost: Ghost) {
  const availableHeight = VIEW - top();
  return {
    x: (props.narrow ? ghost.depth - 1 : ghost.depth) * columnWidth(),
    y: top() + ghost.x0 * availableHeight,
    width: columnWidth() - CELL_GAP,
    height: (ghost.x1 - ghost.x0) * availableHeight - CELL_GAP,
  };
}
</script>

<template>
  <svg
    v-if="layout === 'sunburst'"
    :viewBox="`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`"
    class="absolute inset-0 size-full"
    aria-hidden="true"
  >
    <path
      v-for="(ghost, index) in ghosts"
      :key="index"
      :d="arcPath(ghost) ?? ''"
      class="ghost"
      :style="sunDelay(ghost)"
    />
    <circle :r="RING - CELL_GAP" class="ghost still" />
  </svg>
  <svg
    v-else
    :viewBox="`0 0 ${VIEW} ${VIEW}`"
    preserveAspectRatio="none"
    class="absolute inset-0 size-full"
    aria-hidden="true"
  >
    <rect v-if="narrow" :width="VIEW" :height="HEAD - HEAD_GAP" rx="4" class="ghost still" />
    <rect v-else :width="columnWidth() - CELL_GAP" :height="VIEW" rx="4" class="ghost still" />
    <rect
      v-for="(ghost, index) in ghosts"
      :key="index"
      v-bind="rect(ghost)"
      rx="2"
      class="ghost"
      :style="iceDelay(ghost)"
    />
  </svg>
</template>

<style scoped>
.ghost {
  fill: var(--surface-2);
  animation: sweep v-bind(SWEEP_DURATION) var(--ease) infinite;
}

/* The focus (centre or first column) holds still, so the sweep has an anchor. */
.still {
  animation: none;
}

@keyframes sweep {
  0%,
  100% {
    fill: var(--surface-2);
  }

  50% {
    fill: var(--surface-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ghost {
    animation: none;
  }
}
</style>
