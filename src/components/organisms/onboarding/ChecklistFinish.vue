<script setup lang="ts">
/**
 * The "Try this" finish: the logo's fiddlehead grows in one stroke, up the
 * stem and round into its coil, then its bud and leaflets open. The stem and
 * coil are the logo's two strokes (docs/brand/fern-mark-dark.svg) joined into
 * one line. It holds still until `playing`, so it can wait for the box to
 * finish folding open.
 */
defineProps<{ playing: boolean }>();
</script>

<template>
  <div class="finish" :class="{ playing }">
    <svg viewBox="16 7 37 53" class="fern" aria-hidden="true">
      <path
        class="fern-line"
        pathLength="1"
        d="M40.08 58C40.08 47.97 39.88 38.33 32 37.14C28.68 36.65 24.99 35.58 22.45 33.05C19.92 30.51 18.5 27.08 18.5 23.5C18.5 19.92 19.92 16.49 22.45 13.95C24.99 11.42 28.42 10 32 10C34.78 10 37.4 11.15 39.37 13.12C41.34 15.09 42.37 18.16 42.37 20.95C42.37 23.73 41.05 26.38 38.96 28C36.86 29.62 34.81 29.86 32.43 29.86C31.14 29.86 28.72 29.42 27.3 28C25.88 26.58 24.95 24.42 24.95 22.83C24.95 21.24 25.78 19.01 26.9 17.88C28.03 16.76 30.2 15.62 32.43 16.05"
      />
      <path
        class="fern-bud"
        d="M33.47 18.93C34.9 18.93 35.97 17.85 35.97 16.43C35.97 15.35 35.17 13.93 33.47 13.93C32.04 13.93 30.97 15 30.97 16.43C30.97 17.85 32.04 18.93 33.47 18.93Z"
      />
      <path
        class="fern-leaf left"
        d="M38.56 49.18C33.93 49.84 29.69 49.28 28.46 43.83C31.66 47.01 34.58 42.45 38.56 49.18Z"
      />
      <path
        class="fern-leaf right"
        d="M40.05 46.02C45.52 40.34 46.54 44.08 50.23 40.7C49.5 45.39 45.22 48.42 40.05 46.02Z"
      />
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

.fern {
  width: 3rem;
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
  stroke-width: 4.5;
  stroke-linecap: round;
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

.fern-leaf {
  fill: var(--text-muted);
}

/* Each leaflet opens from where it meets the stem. */
.fern-leaf.left {
  transform-origin: right bottom;
  animation-delay: 0.7s;
}

.fern-leaf.right {
  transform-origin: left bottom;
  animation-delay: 0.9s;
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
