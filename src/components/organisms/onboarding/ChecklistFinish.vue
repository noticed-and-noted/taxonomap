<script setup lang="ts">
/**
 * The "Try this" finish: the logo's fiddlehead grows in one stroke, up the
 * stem and round into its coil, then its bud and leaflets open. The stem and
 * coil are the logo's two strokes (SiteHeader.astro) joined into one line,
 * with the coil's transform worked into its coordinates. It holds still until
 * `playing`, so it can wait for the box to finish folding open.
 */
defineProps<{ playing: boolean }>();
</script>

<template>
  <div class="finish" :class="{ playing }">
    <svg viewBox="16 7 37 53" class="fern" aria-hidden="true">
      <path
        class="fern-line"
        pathLength="1"
        d="M40 58C40 48 40 37 32 37A13.5 13.5 0 0 1 32 10A10.5 10.5 0 0 1 32 31A6 6 0 0 1 32 19"
      />
      <circle class="fern-bud" cx="32.4" cy="19" r="2.7" />
      <path class="fern-leaf left" d="M40 51C35 50 31 47 30 43C35 43 38 46 40 51Z" />
      <path class="fern-leaf right" d="M40 46C44 44 48 44 51 41C50 46 45 48 40 46Z" />
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
