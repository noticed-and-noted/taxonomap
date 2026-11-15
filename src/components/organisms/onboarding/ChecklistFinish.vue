<script setup lang="ts">
/**
 * The "Try this" finish: the logo's fiddlehead grows in one stroke, up the
 * stem and round into its coil (the mark's coil runs from the stem's foot),
 * then its ball and leaf open. It holds still until `playing`, so it can wait
 * for the box to finish folding open.
 */
import { BALL, COIL, COIL_STROKE_WIDTH, LEAF, MARK_VIEWBOX } from '~/lib/wordmark';

defineProps<{ playing: boolean }>();
</script>

<template>
  <div class="finish" :class="{ playing }">
    <svg :viewBox="MARK_VIEWBOX" class="fern" aria-hidden="true">
      <path class="fern-line" pathLength="1" :d="COIL" :stroke-width="COIL_STROKE_WIDTH" />
      <path class="fern-bud" :d="BALL" />
      <path class="fern-leaf" :d="LEAF" />
    </svg>
    <p class="font-display text-base" aria-hidden="true">You've found your way around</p>
    <p class="text-xs text-muted" aria-hidden="true">All seven done. Happy exploring.</p>
    <!-- Filled in as the fern starts, so screen readers hear it once the finish is shown. -->
    <p class="sr-only" role="status">{{ playing ? "You've found your way around. All seven done." : '' }}</p>
  </div>
</template>

<style scoped>
.finish {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0 0.125rem;
  text-align: center;
}

/* The mark's 110 x 129 units. */
.fern {
  width: 3.625rem;
  height: 4.25rem;
  margin-bottom: 0.25rem;
}

/* Paused animations hold their first frame (the fern unseen) until the box has opened. */
.finish:not(.playing) * {
  animation-play-state: paused;
}

/* Drawn from the stem's foot to the coil's tip, like a frond growing. */
.fern-line {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: fern-grow 1.4s var(--ease) 0.1s forwards;
}

.fern-bud,
.fern-leaf {
  transform: scale(0);
  transform-box: fill-box;
  animation: fern-open 0.35s var(--ease) forwards;
}

.fern-bud {
  fill: var(--accent);
  transform-origin: center;
  animation-delay: 1.45s;
}

/* The leaf opens from where it meets the stem. */
.fern-leaf {
  fill: var(--leaf);
  transform-origin: left bottom;
  animation-delay: 0.8s;
}

@keyframes fern-grow {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes fern-open {
  to {
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fern-line,
  .fern-bud,
  .fern-leaf {
    animation: none;
    stroke-dashoffset: 0;
    transform: none;
  }
}
</style>
