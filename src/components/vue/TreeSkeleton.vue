<script setup lang="ts">
/**
 * Loading stand-in for TreeChart: a made-up partition drawn in the chart's
 * own shape, with a shimmer that sweeps clockwise round the sunburst and
 * top to bottom down each icicle column.
 */
import { arc } from 'd3-shape';

const props = defineProps<{ layout: 'sunburst' | 'icicle'; narrow: boolean }>();

type Ghost = { rel: number; x0: number; x1: number };

const LEVELS = 3;
const VIEW = 400;
const RING = VIEW / 2 / (LEVELS + 1);
const SWEEP_SECONDS = 1.8;
/** How far each icicle column lags the one before, as a share of the sweep. */
const COLUMN_LAG = 0.15;
const HEAD = 44;

/** Branch weights per level: each entry splits its parent into those shares. */
const BRANCHES: number[][] = [
  [3, 2, 2, 1],
  [2, 1, 1, 1, 1, 2, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];
const CHILD_COUNTS: number[][] = [[4], [2, 3, 2, 1], [3, 2, 2, 2, 3, 2, 2, 2]];

function splitLevel(parents: Ghost[], weights: number[], counts: number[], rel: number): Ghost[] {
  const out: Ghost[] = [];
  let next = 0;
  parents.forEach((parent, parentIndex) => {
    const shares = weights.slice(next, next + (counts[parentIndex] ?? 1));
    next += shares.length;
    const total = shares.reduce((sum, share) => sum + share, 0);
    let start = parent.x0;
    for (const share of shares) {
      const end = start + ((parent.x1 - parent.x0) * share) / total;
      out.push({ rel, x0: start, x1: end });
      start = end;
    }
  });
  return out;
}

const ghosts: Ghost[] = [];
let level: Ghost[] = [{ rel: 0, x0: 0, x1: 1 }];
for (let depth = 0; depth < LEVELS; depth++) {
  level = splitLevel(level, BRANCHES[depth] ?? [], CHILD_COUNTS[depth] ?? [], depth + 1);
  ghosts.push(...level);
}

const arcGen = arc<Ghost>()
  .startAngle((ghost) => ghost.x0 * 2 * Math.PI)
  .endAngle((ghost) => ghost.x1 * 2 * Math.PI)
  .padAngle(0.012)
  .padRadius(RING * 1.5)
  .innerRadius((ghost) => ghost.rel * RING)
  .outerRadius((ghost) => (ghost.rel + 1) * RING - 3);

const delay = (seconds: number) => ({ animationDelay: `${(seconds * SWEEP_SECONDS).toFixed(2)}s` });
const sunDelay = (ghost: Ghost) => delay(ghost.x0);
const iceDelay = (ghost: Ghost) => delay(ghost.x0 + ghost.rel * COLUMN_LAG);

const top = () => (props.narrow ? HEAD : 0);
const columnWidth = () => VIEW / (props.narrow ? LEVELS : LEVELS + 1);
function rect(ghost: Ghost) {
  const availableHeight = VIEW - top();
  return {
    x: (props.narrow ? ghost.rel - 1 : ghost.rel) * columnWidth(),
    y: top() + ghost.x0 * availableHeight,
    width: columnWidth() - 2,
    height: (ghost.x1 - ghost.x0) * availableHeight - 2,
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
      :d="arcGen(ghost) ?? ''"
      class="ghost"
      :style="sunDelay(ghost)"
    />
    <circle :r="RING - 2" class="ghost still" />
  </svg>
  <svg
    v-else
    :viewBox="`0 0 ${VIEW} ${VIEW}`"
    preserveAspectRatio="none"
    class="absolute inset-0 size-full"
    aria-hidden="true"
  >
    <rect v-if="narrow" :width="VIEW" :height="HEAD - 6" rx="4" class="ghost still" />
    <rect v-else :width="columnWidth() - 2" :height="VIEW" rx="4" class="ghost still" />
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
  animation: sweep 1.8s var(--ease) infinite;
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
