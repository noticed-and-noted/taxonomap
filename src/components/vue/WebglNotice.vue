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
        <g fill="none" stroke="var(--accent)" stroke-width="4.5" stroke-linecap="round">
          <path d="M40.08 58C40.08 47.97 39.88 38.33 32 37.14"></path>
          <path
            d="M32 37.14C28.68 36.65 24.99 35.58 22.45 33.05C19.92 30.51 18.5 27.08 18.5 23.5C18.5 19.92 19.92 16.49 22.45 13.95C24.99 11.42 28.42 10 32 10C34.78 10 37.4 11.15 39.37 13.12C41.34 15.09 42.37 18.16 42.37 20.95C42.37 23.73 41.05 26.38 38.96 28C36.86 29.62 34.81 29.86 32.43 29.86C31.14 29.86 28.72 29.42 27.3 28C25.88 26.58 24.95 24.42 24.95 22.83C24.95 21.24 25.78 19.01 26.9 17.88C28.03 16.76 30.2 15.62 32.43 16.05"
          ></path>
        </g>
        <path
          d="M33.47 18.93C34.9 18.93 35.97 17.85 35.97 16.43C35.97 15.35 35.17 13.93 33.47 13.93C32.04 13.93 30.97 15 30.97 16.43C30.97 17.85 32.04 18.93 33.47 18.93Z"
          fill="var(--accent)"
        ></path>
        <path
          d="M38.56 49.18C33.93 49.84 29.69 49.28 28.46 43.83C31.66 47.01 34.58 42.45 38.56 49.18Z"
          fill="var(--text-muted)"
        ></path>
        <path
          d="M40.05 46.02C45.52 40.34 46.54 44.08 50.23 40.7C49.5 45.39 45.22 48.42 40.05 46.02Z"
          fill="var(--text-muted)"
        ></path>
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
