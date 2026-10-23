<script setup lang="ts">
/**
 * Stands in for the map when the browser can't give MapLibre a WebGL2 context:
 * says how to turn graphics acceleration back on, and points to the pages that work without it.
 */
const retry = () => window.location.reload();
</script>

<template>
  <div class="absolute inset-0 flex items-center justify-center bg-bg p-4" role="alert">
    <div class="w-full max-w-md text-center">
      <svg viewBox="16 7 32 53" class="mx-auto mb-3 h-14" aria-hidden="true">
        <path
          d="M40 58C40 48 40 37 32 37"
          fill="none"
          stroke="var(--accent)"
          stroke-width="4.5"
          stroke-linecap="round"
        ></path>
        <g transform="translate(17 8.5) scale(0.75)">
          <path
            d="M20 38A18 18 0 0 1 20 2A14 14 0 0 1 20 30A8 8 0 0 1 20 14"
            fill="none"
            stroke="var(--accent)"
            stroke-width="6"
            stroke-linecap="round"
          ></path>
          <circle cx="20.5" cy="14" r="3.6" fill="var(--accent)"></circle>
        </g>
        <path d="M40 51C35 50 31 47 30 43C35 43 38 46 40 51Z" fill="var(--text-muted)"></path>
        <path d="M40 46C44 44 48 44 51 41C50 46 45 48 40 46Z" fill="var(--text-muted)"></path>
      </svg>
      <h2 class="text-xl">The map can’t draw on this device</h2>
      <p class="mt-1 text-sm text-muted">
        It needs WebGL, which this browser has turned off or doesn’t support. The tree of life and species pages still
        work.
      </p>

      <div class="mt-4 rounded-lg border border-border bg-surface p-4 text-left text-sm shadow-panel">
        <p class="font-medium text-text">To turn it back on</p>
        <ul class="mt-2 space-y-1.5 text-muted">
          <li>
            <span class="text-text">Chrome or Edge:</span> Settings › System › “Use graphics acceleration when
            available”, then relaunch.
          </li>
          <li>
            <span class="text-text">Firefox:</span> Settings › General › Performance › “Use hardware acceleration when
            available”.
          </li>
          <li>
            <span class="text-text">Safari, or still not working:</span> update the browser and your graphics drivers,
            or try another browser.
          </li>
        </ul>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 font-medium text-text transition-colors duration-(--dur-fast) ease-field hover:bg-surface-3 sm:min-h-9"
            @click="retry"
          >
            Try again
          </button>
          <a
            href="/tree"
            class="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-text transition-colors duration-(--dur-fast) ease-field hover:bg-surface-2 sm:min-h-9"
          >
            Tree of life
          </a>
        </div>
      </div>
    </div>
  </div>
</template>
