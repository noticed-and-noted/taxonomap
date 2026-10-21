<script setup lang="ts">
/**
 * "Try this": seven things to do on the site, shown above the map legend once
 * the tour is over. Collapsed it shows progress and the next item; open, the
 * whole list. Items tick themselves (see stores/onboarding.ts), and the list
 * goes away for good once everything is done or the viewer hides it.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, ref, useId } from 'vue';
import { $checklistDone, $checklistHidden, $tourOpen, $tourSeen, CHECKLIST, hideChecklist } from '~/stores/onboarding';
import { useScrollFade } from './useScrollFade';

const done = useStore($checklistDone);
const isHidden = useStore($checklistHidden);
const tourSeen = useStore($tourSeen);
const tourOpen = useStore($tourOpen);
const isOpen = ref(false);
const listId = useId();
const list = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFade } = useScrollFade(list);

async function toggle() {
  isOpen.value = !isOpen.value;
  await nextTick();
  updateFade();
}

const isShown = computed(
  () => tourSeen.value && !tourOpen.value && !isHidden.value && done.value.length < CHECKLIST.length,
);
const nextItem = computed(() => CHECKLIST.find((item) => !done.value.includes(item.id)));
const percent = computed(() => Math.round((done.value.length / CHECKLIST.length) * 100));
</script>

<template>
  <section v-if="isShown" class="try-this" aria-label="Try this">
    <div class="flex items-center gap-1">
      <button type="button" class="try-toggle" :aria-expanded="isOpen" :aria-controls="listId" @click="toggle">
        <span class="font-display text-sm">Try this</span>
        <span class="ml-auto text-xs text-subtle tabular-nums">{{ done.length }} of {{ CHECKLIST.length }}</span>
        <svg
          viewBox="0 0 24 24"
          class="size-4 text-muted"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          aria-hidden="true"
        >
          <path :d="isOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button type="button" class="try-hide" aria-label="Hide Try this" @click="hideChecklist">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <div class="try-bar" aria-hidden="true"><span :style="{ width: `${percent}%` }"></span></div>
    <p v-if="!isOpen && nextItem" class="mt-1.5 text-xs text-muted">Next: {{ nextItem.title }}</p>
    <ul
      v-show="isOpen"
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
          <circle cx="12" cy="12" r="9" :class="done.includes(item.id) ? 'text-accent' : 'text-subtle'" />
          <path
            v-if="done.includes(item.id)"
            d="m8 12.5 2.5 2.5L16 9.5"
            class="text-accent"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div class="min-w-0">
          <p class="text-sm" :class="done.includes(item.id) ? 'text-subtle line-through' : 'text-text'">
            {{ item.title }}<span v-if="done.includes(item.id)" class="sr-only"> (done)</span>
          </p>
          <p class="text-xs text-subtle">{{ item.hint }}</p>
        </div>
      </li>
    </ul>
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
  max-height: min(16rem, 30dvh);
}

.try-toggle {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  border-radius: var(--radius-sm);
  text-align: left;
}

.try-hide {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.try-hide:hover {
  color: var(--text);
  background: var(--surface-2);
}

.try-bar {
  height: 0.25rem;
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
  .try-toggle {
    min-height: 2rem;
  }

  .try-hide {
    width: 2rem;
    height: 2rem;
  }
}
</style>
