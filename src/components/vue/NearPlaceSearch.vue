<script setup lang="ts">
/**
 * Place search for the near-me panel: searches on submit only (Nominatim
 * policy, see geocode.ts); one match moves the pin straight away, several
 * are listed to pick from.
 */
import { ref } from 'vue';
import { searchPlaces, type Place } from '~/lib/geocode';
import { setNearLocation } from '~/stores/near';

const query = ref('');
const results = ref<Place[] | null>(null);
const state = ref<'idle' | 'searching' | 'failed'>('idle');
let abort: AbortController | undefined;

async function submit() {
  const q = query.value.trim();
  if (!q) return;
  abort?.abort();
  abort = new AbortController();
  state.value = 'searching';
  try {
    const found = await searchPlaces(q, abort.signal);
    state.value = 'idle';
    if (found.length === 1) pick(found[0]!);
    else results.value = found;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') state.value = 'failed';
  }
}

function pick(p: Place) {
  setNearLocation(p.lat, p.lng);
  results.value = null;
  query.value = p.name;
}

function onInput() {
  results.value = null;
  state.value = 'idle';
}
</script>

<template>
  <div class="space-y-1.5">
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
          />
        </span>
      </label>
      <button
        type="submit"
        class="shrink-0 rounded-md border border-border px-3 text-sm hover:border-accent disabled:opacity-60"
        :disabled="state === 'searching' || !query.trim()"
      >
        {{ state === 'searching' ? 'Searching…' : 'Go' }}
      </button>
    </form>
    <ul v-if="results?.length" class="overflow-hidden rounded-md border border-border text-sm" aria-label="Places">
      <li v-for="(p, i) in results" :key="i">
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-surface-2" @click="pick(p)">
          <span class="block truncate text-text">{{ p.name }}</span>
          <span v-if="p.detail" class="block truncate text-xs text-muted">{{ p.detail }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="results" class="text-xs text-muted" role="status">No places found.</p>
    <p v-if="state === 'failed'" class="text-xs text-muted" role="status">Place search is unavailable right now.</p>
  </div>
</template>
