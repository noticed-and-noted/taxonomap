<script setup lang="ts">
/**
 * Stands in for the map when the browser can't give MapLibre a WebGL2 context:
 * shows this browser's steps for turning graphics acceleration back on (others behind a disclosure),
 * and points to the pages that work without it.
 */
import { detectBrowser, WEBGL_HELP } from '~/lib/map/webglHelp';
import UiIcon from './UiIcon.vue';

const browserId = detectBrowser(navigator.userAgent);
const help = WEBGL_HELP.find((entry) => entry.id === browserId)!;
const otherHelp = WEBGL_HELP.filter((entry) => entry.id !== browserId && entry.id !== 'other');
const retry = () => window.location.reload();
</script>

<template>
  <div class="webgl-notice absolute inset-0 flex justify-center overflow-y-auto bg-bg px-4" role="alert">
    <!-- my-auto, not items-center, so a notice taller than the screen scrolls instead of losing its top. -->
    <div class="my-auto w-full max-w-md text-center">
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
        It needs WebGL, which {{ help.name }} has turned off or doesn’t support. The tree of life and species pages
        still work.
      </p>

      <div class="mt-4 rounded-lg border border-border bg-surface p-4 text-left text-sm shadow-panel">
        <p class="font-medium text-text">{{ browserId === 'other' ? 'To turn it back on' : `In ${help.name}` }}</p>
        <ol class="mt-2 list-decimal space-y-1.5 pl-5 text-muted marker:text-subtle">
          <li v-for="step in help.steps" :key="step">{{ step }}</li>
        </ol>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 font-medium text-text transition-colors duration-(--dur-fast) ease-field hover:bg-surface-3 sm:min-h-9"
            @click="retry"
          >
            Try again
          </button>
          <a
            href="/tree/"
            class="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-text transition-colors duration-(--dur-fast) ease-field hover:bg-surface-2 sm:min-h-9"
          >
            Tree of life
          </a>
        </div>
        <details class="mt-4 border-t border-border pt-3">
          <summary class="text-muted hover:text-text">
            <UiIcon name="chevron-right" class="chevron" /> Other browsers
          </summary>
          <dl class="mt-2 space-y-2">
            <div v-for="entry in otherHelp" :key="entry.id">
              <dt class="text-text">{{ entry.name }}</dt>
              <dd class="text-muted">{{ entry.steps.join(' ') }}</dd>
            </div>
          </dl>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Clear the floating header above and the legend (on phones, the taller dock) below, so every line scrolls into view. */
.webgl-notice {
  padding-top: calc(var(--header-offset) + 2rem + 2 * var(--header-gap));
  padding-bottom: 7rem;
}
@media (max-width: 639.98px) {
  .webgl-notice {
    padding-bottom: 12rem;
  }
}
</style>
