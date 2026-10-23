<script setup lang="ts">
/**
 * Place search for the near-me panel: searched as you type (usePlaceSearch),
 * matches listed to pick from; Enter or Go picks the first.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Place } from '~/lib/geocode';
import { setNearLocation } from '~/stores/near';
import { usePlaceSearch } from './usePlaceSearch';

const query = ref('');
const root = ref<HTMLElement>();
const { places, loading, failed, answered, search, flush, reset } = usePlaceSearch();

const open = ref(true);

function close() {
  open.value = false;
}
function onOutside(event: Event) {
  if (!root.value?.contains(event.target as Node)) close();
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside);
  document.removeEventListener('keydown', onKey);
});

/** Enter or Go: the first match once results are in; otherwise search now. */
function submit() {
  open.value = true;
  const [first] = places.value;
  if (!loading.value && first) pick(first);
  else flush();
}

function pick(place: Place) {
  setNearLocation(place.lat, place.lng);
  reset();
  query.value = place.name;
}

function onInput() {
  open.value = true;
  search(query.value);
}
</script>

<template>
  <div ref="root" class="relative">
    <form role="search" class="flex gap-2" @submit.prevent="submit">
      <label class="min-w-0 flex-1">
        <span class="sr-only">Search for a place</span>
        <span class="relative block">
          <svg
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <input
            v-model="query"
            type="search"
            enterkeyhint="search"
            placeholder="Search a place"
            autocomplete="off"
            class="w-full rounded-md border border-border-strong bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-subtle focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
            @input="onInput"
            @focus="open = true"
          />
        </span>
      </label>
      <button
        type="submit"
        class="shrink-0 rounded-md border border-border px-3 text-sm hover:border-accent disabled:opacity-60"
        :disabled="!query.trim()"
      >
        {{ loading ? 'Searching…' : 'Go' }}
      </button>
    </form>
    <ul
      v-if="open && places.length"
      class="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface text-sm shadow-panel"
      aria-label="Places"
    >
      <li v-for="(place, index) in places" :key="index">
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-surface-2" @click="pick(place)">
          <span class="block truncate text-text">{{ place.name }}</span>
          <span v-if="place.detail" class="block truncate text-xs text-muted">{{ place.detail }}</span>
        </button>
      </li>
    </ul>
    <p
      v-else-if="open && answered && !loading && !failed"
      class="absolute inset-x-0 top-full z-20 mt-1 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-panel"
      role="status"
    >
      No places found.
    </p>
    <p
      v-if="open && failed"
      class="absolute inset-x-0 top-full z-20 mt-1 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted shadow-panel"
      role="status"
    >
      Place search is unavailable right now.
    </p>
  </div>
</template>
