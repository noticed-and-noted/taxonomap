<script setup lang="ts">
/**
 * "Try this": seven things to do on the site, shown above the map legend once
 * the tour is over. Collapsed it shows progress and the next item; open, the
 * whole list. Items tick themselves (see stores/onboarding.ts), each with a
 * pen-stroke tick. Finishing the last one folds the list away and the fern in,
 * which grows once the fold settles and stays until it is closed; after that,
 * or once the viewer hides it, the list is gone for good.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';
import { useScrollFade } from '~/composables/useScrollFade';
import { $nearMode } from '~/stores/near';
import {
  $checklistDone,
  $checklistHint,
  $checklistJustFinished,
  $checklistShown,
  CHECKLIST,
  hideChecklist,
  type ChecklistId,
} from '~/stores/onboarding';
import ChecklistFinish from './ChecklistFinish.vue';

const done = useStore($checklistDone);
// In Near me a map click drops a pin rather than picking a hex, so the hints step aside there.
const near = useStore($nearMode);
const isOpen = ref(false);
const listId = useId();
const list = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFade } = useScrollFade(list);

async function toggle() {
  isOpen.value = !isOpen.value;
  await nextTick();
  updateFade();
}

const justFinished = useStore($checklistJustFinished);
/** The finish folds open over the list, a moment late so the last tick and the bar finish first. */
const isFinishing = ref(false);
/** The fern grows only once the fold is fully open. */
const isFernPlaying = ref(false);
const finishFold = ref<HTMLElement>();
const FINISH_DELAY_MS = 600;

function openFinish() {
  if (!$checklistJustFinished.get() || !finishFold.value) return;
  isFinishing.value = true;
  // The fold's own duration (0 under reduced motion), so the fern starts as it settles.
  const foldMs = parseFloat(getComputedStyle(finishFold.value).transitionDuration) * 1000;
  window.setTimeout(() => (isFernPlaying.value = true), foldMs);
}

watch(justFinished, (isJust) => {
  if (isJust) return void window.setTimeout(openFinish, FINISH_DELAY_MS);
  isFinishing.value = false;
  isFernPlaying.value = false;
});
// Back from another page with the list just finished: fold it open straight away.
onMounted(() => justFinished.value && requestAnimationFrame(openFinish));
const closeFinish = () => $checklistJustFinished.set(false);

const isShown = useStore($checklistShown);
const nextItem = computed(() => CHECKLIST.find((item) => !done.value.includes(item.id)));
/** Spotlight where this item happens (see ChecklistHint.vue). */
const showHint = (id: ChecklistId) => $checklistHint.set(id);
const percent = computed(() => Math.round((done.value.length / CHECKLIST.length) * 100));
</script>

<template>
  <section v-if="isShown" class="try-this" aria-label="Try this">
    <div v-if="justFinished" ref="finishFold" class="try-collapse" :class="{ open: isFinishing }" :inert="!isFinishing">
      <div class="relative">
        <ChecklistFinish :playing="isFernPlaying" />
        <button type="button" class="try-hide absolute right-0 top-0" aria-label="Close" @click="closeFinish">
          <svg
            viewBox="0 0 24 24"
            class="size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
    <div class="try-collapse" :class="{ open: !isFinishing }" :inert="isFinishing">
      <div>
        <div class="flex items-center gap-1">
          <div class="try-heading">
            <span class="font-display text-sm">Try this</span>
            <span class="ml-auto text-xs text-subtle tabular-nums">{{ done.length }} of {{ CHECKLIST.length }}</span>
          </div>
          <button
            type="button"
            class="try-icon"
            aria-label="Try this list"
            :aria-expanded="isOpen"
            :aria-controls="listId"
            @click="toggle"
          >
            <svg
              viewBox="0 0 24 24"
              class="try-chevron size-4"
              :class="{ open: isOpen }"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              aria-hidden="true"
            >
              <path d="m6 15 6-6 6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <button type="button" class="try-hide" aria-label="Hide Try this" @click="hideChecklist">
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="try-bar" aria-hidden="true"><span :style="{ width: `${percent}%` }"></span></div>
        <div v-if="nextItem" class="try-collapse" :class="{ open: !isOpen }" :inert="isOpen">
          <div>
            <p class="mt-1.5 text-xs text-muted">Next: {{ nextItem.title }}</p>
          </div>
        </div>
        <div class="try-collapse" :class="{ open: isOpen }" :inert="!isOpen">
          <div>
            <ul
              :id="listId"
              ref="list"
              class="try-list fade-list mt-2 space-y-2 overflow-y-auto overscroll-contain"
              :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
              @scroll="updateFade"
            >
              <li v-for="item in CHECKLIST" :key="item.id" class="flex gap-2">
                <svg
                  viewBox="0 0 24 24"
                  class="mt-px size-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    class="try-ring"
                    :class="done.includes(item.id) ? 'text-accent' : 'text-subtle'"
                  />
                  <path
                    d="m8 12.5 2.5 2.5L16 9.5"
                    pathLength="1"
                    class="try-tick"
                    :class="{ 'is-done': done.includes(item.id) }"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <div class="min-w-0 flex-1">
                  <p class="text-sm" :class="done.includes(item.id) ? 'text-subtle line-through' : 'text-text'">
                    {{ item.title }}<span v-if="done.includes(item.id)" class="sr-only"> (done)</span>
                  </p>
                  <p class="text-xs text-subtle">{{ item.hint }}</p>
                </div>
                <button
                  v-if="!near && !done.includes(item.id)"
                  type="button"
                  class="try-help"
                  :aria-label="`Show me where: ${item.title}`"
                  title="Show me where"
                  @click="showHint(item.id)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    class="size-4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01" stroke-linecap="round" />
                  </svg>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.try-this {
  padding-bottom: 0.75rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--border);
}

/* Short enough that the open list stays clear of the filter rail above the dock. */
.try-list {
  /* 248px at default text size: leaves a gap between the dock and the filter rail above it. */
  max-height: min(15.5rem, 30dvh);
  scrollbar-width: thin;
}

/* Folds open and shut: the row grows from 0fr to 1fr, so no height has to be known. */
.try-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur) var(--ease);
}

.try-collapse.open {
  grid-template-rows: 1fr;
}

.try-collapse > div {
  min-height: 0;
  overflow: hidden;
}

/* Up to open the list (it unfolds upward), turning down to close it. */
.try-chevron {
  transition: transform var(--dur) var(--ease);
}

.try-chevron.open {
  transform: rotate(180deg);
}

.try-ring {
  transition: color var(--dur-fast) var(--ease);
}

/* The tick draws itself like a pen stroke when the item is done. */
.try-tick {
  stroke: var(--accent);
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset var(--dur) var(--ease);
}

.try-tick.is-done {
  stroke-dashoffset: 0;
}

.try-heading {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
}

.try-icon,
.try-hide {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.try-help {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.try-help:hover {
  color: var(--text);
  background: var(--surface-2);
}

.try-icon:hover,
.try-hide:hover {
  color: var(--text);
  background: var(--surface-2);
}

.try-bar {
  height: 0.25rem;
  /* Clear of the heading buttons' hover squares, which fill the row. */
  margin-top: 0.375rem;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}

.try-bar span {
  display: block;
  height: 100%;
  background: var(--ramp-4);
  transition: width var(--dur) var(--ease);
}

@media (min-width: 640px) {
  .try-heading {
    min-height: 2rem;
  }

  .try-icon,
  .try-hide {
    width: 2rem;
    height: 2rem;
  }

  .try-help {
    width: 2rem;
    height: 2rem;
  }
}
</style>
