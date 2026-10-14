<script setup lang="ts">
/**
 * Header search (client:idle). Species: the baked common-name index answers
 * instantly; live GBIF providers (scientific suggest + vernacular search)
 * are debounced 250 ms. Places: geocoder on submit only (Nominatim policy).
 * ARIA 1.2 combobox with a listbox popup.
 */
import { navigate } from 'astro:transitions/client';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { bakedIndexProvider, loadNameIndex, nameIndexWithin } from '~/lib/data/name-index';
import { compact, RANK_LABELS } from '~/lib/format';
import { searchPlaces, type Place } from '~/lib/geocode';
import { gbifSuggestProvider, gbifVernacularProvider, mapCapabilities, type NameHit } from '~/lib/gbif';
import { debounce } from '~/lib/util/debounce';
import { $flyTo, $taxonKey, clearHexSelection } from '~/stores/explorer';
import { primeTaxonInfo } from '~/stores/taxon';

type Option =
  | { kind: 'taxon'; id: string; hit: NameHit }
  | { kind: 'place-search'; id: string }
  | { kind: 'place'; id: string; place: Place };

const MAX_TAXA = 8;
const query = ref('');
const open = ref(false);
const active = ref(-1);
const indexHits = ref<NameHit[]>([]);
const liveHits = ref<NameHit[]>([]);
const places = ref<Place[] | null>(null);
const liveLoading = ref(false);
const liveFailed = ref(false);
const placeLoading = ref(false);
const placeFailed = ref(false);
const input = ref<HTMLInputElement>();
let liveAbort: AbortController | undefined;

const taxa = computed(() => {
  const seen = new Set<number>();
  const out: NameHit[] = [];
  // Live scientific matches are mostly noise once the index has answers.
  const live = indexHits.value.length ? liveHits.value.slice(0, 3) : liveHits.value;
  for (const h of [...indexHits.value, ...live]) {
    if (seen.has(h.key)) continue;
    seen.add(h.key);
    out.push(h);
    if (out.length >= MAX_TAXA) break;
  }
  return out;
});

const options = computed<Option[]>(() => {
  if (places.value) return places.value.map((place, i) => ({ kind: 'place', id: `omni-place-${i}`, place }));
  const opts: Option[] = taxa.value.map((hit) => ({ kind: 'taxon', id: `omni-taxon-${hit.key}`, hit }));
  if (query.value.trim().length >= 2) opts.push({ kind: 'place-search', id: 'omni-place-search' });
  return opts;
});

const activeId = computed(() => options.value[active.value]?.id);

async function runIndex(q: string) {
  indexHits.value = await bakedIndexProvider.search(q);
}

const runLive = debounce(async (q: string) => {
  liveAbort?.abort();
  if (q.trim().length < 3) {
    liveHits.value = [];
    liveLoading.value = false;
    return;
  }
  const ctrl = new AbortController();
  liveAbort = ctrl;
  liveLoading.value = true;
  liveFailed.value = false;
  // Let the local index answer first, so live results never reorder the list
  // under the pointer, and decide on the vernacular search with it loaded.
  await nameIndexWithin(1500);
  await runIndex(q);
  if (ctrl.signal.aborted) return;
  const results = await Promise.allSettled([
    gbifSuggestProvider.search(q, ctrl.signal),
    // Vernacular search ranks poorly, so only use it when the index is thin.
    indexHits.value.length < 3 ? gbifVernacularProvider.search(q, ctrl.signal) : Promise.resolve([]),
  ]);
  if (ctrl.signal.aborted) return;
  liveHits.value = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  liveFailed.value = results.every((r) => r.status === 'rejected');
  liveLoading.value = false;
}, 250);

function onInput() {
  places.value = null;
  placeFailed.value = false;
  open.value = true;
  active.value = -1;
  const q = query.value;
  void runIndex(q);
  runLive(q);
}

function onFocus() {
  void loadNameIndex(); // warm the index on first focus
  if (query.value) open.value = true;
}

function close() {
  open.value = false;
  active.value = -1;
}

async function runPlaceSearch() {
  const q = query.value.trim();
  if (!q) return;
  placeLoading.value = true;
  placeFailed.value = false;
  try {
    places.value = await searchPlaces(q);
    open.value = true;
    active.value = places.value.length ? 0 : -1;
  } catch {
    placeFailed.value = true;
    places.value = [];
  } finally {
    placeLoading.value = false;
  }
}

function onMapPage() {
  return window.location.pathname === '/' || window.location.pathname === '';
}

async function pickTaxon(hit: NameHit) {
  primeTaxonInfo({
    key: hit.key,
    scientificName: hit.scientificName,
    rank: hit.rank,
    ...(hit.commonName && { commonName: hit.commonName }),
  });
  clearHexSelection();
  $taxonKey.set(hit.key);
  query.value = '';
  indexHits.value = [];
  liveHits.value = [];
  close();
  input.value?.blur();
  if (!onMapPage()) return;
  try {
    const cap = await mapCapabilities({ taxonKey: hit.key });
    if (cap.total > 0) {
      $flyTo.set({ kind: 'bounds', bbox: [cap.minLng, cap.minLat, cap.maxLng, cap.maxLat], maxZoom: 6 });
    }
  } catch {
    /* stay where we are */
  }
}

function pickPlace(p: Place) {
  close();
  query.value = '';
  places.value = null;
  input.value?.blur();
  const zoom = p.bbox ? undefined : 10;
  if (!onMapPage()) {
    const z = zoom ?? 8;
    void navigate(`/?view=${p.lng.toFixed(2)},${p.lat.toFixed(2)},${z.toFixed(1)}`);
    return;
  }
  $flyTo.set(
    p.bbox ? { kind: 'bounds', bbox: p.bbox, maxZoom: 12 } : { kind: 'point', lng: p.lng, lat: p.lat, zoom: 10 },
  );
}

function choose(o: Option | undefined) {
  if (!o) return;
  if (o.kind === 'taxon') void pickTaxon(o.hit);
  else if (o.kind === 'place') pickPlace(o.place);
  else void runPlaceSearch();
}

function onKeydown(e: KeyboardEvent) {
  const n = options.value.length;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    open.value = true;
    active.value = n ? (active.value + 1) % n : -1;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = n ? (active.value - 1 + n) % n : -1;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (active.value >= 0) choose(options.value[active.value]);
    else void runPlaceSearch();
  } else if (e.key === 'Escape') {
    if (open.value) close();
    else query.value = '';
  }
}

function onBlur(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (!next || !(e.currentTarget as HTMLElement).parentElement?.contains(next)) close();
}

// The omnibox hydrates on idle: pick up anything typed before that.
onMounted(() => {
  const typed = input.value?.value ?? '';
  if (typed && !query.value) {
    query.value = typed;
    if (document.activeElement === input.value) onFocus();
    onInput();
  }
});

onBeforeUnmount(() => {
  runLive.cancel();
  liveAbort?.abort();
});
</script>

<template>
  <div class="omnibox relative w-full max-w-xl" @focusout="onBlur">
    <label for="omnibox-input" class="sr-only">Search species or places</label>
    <div
      class="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 shadow-panel transition-colors duration-200 focus-within:border-accent"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-4 shrink-0 text-subtle"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        id="omnibox-input"
        ref="input"
        v-model="query"
        type="search"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        placeholder="Search species or places…"
        class="h-[calc(var(--header-height)-2px)] w-full min-w-0 bg-transparent text-sm text-text placeholder:text-subtle focus:outline-none"
        aria-autocomplete="list"
        aria-controls="omnibox-listbox"
        :aria-expanded="open && options.length > 0"
        :aria-activedescendant="activeId"
        @input="onInput"
        @focus="onFocus"
        @keydown="onKeydown"
      />
      <span v-if="liveLoading || placeLoading" class="spinner" aria-hidden="true"></span>
    </div>

    <div
      v-show="open && (options.length > 0 || placeFailed || (places && !places.length))"
      class="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-panel"
    >
      <ul
        id="omnibox-listbox"
        role="listbox"
        :aria-label="places ? 'Places' : 'Species and places'"
        class="max-h-[60vh] overflow-auto py-1"
      >
        <li
          v-for="(o, i) in options"
          :id="o.id"
          :key="o.id"
          role="option"
          :aria-selected="i === active"
          class="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm aria-selected:bg-accent-soft"
          @mousedown.prevent
          @click="choose(o)"
          @mousemove="active = i"
        >
          <template v-if="o.kind === 'taxon'">
            <span class="min-w-0 flex-1">
              <span v-if="o.hit.commonName" class="block truncate font-medium text-text">{{ o.hit.commonName }}</span>
              <span class="sci-name block truncate" :class="o.hit.commonName ? 'text-xs text-muted' : 'text-text'">{{
                o.hit.scientificName
              }}</span>
            </span>
            <span class="shrink-0 text-right text-[11px] leading-tight text-subtle">
              <span class="block">{{ RANK_LABELS[o.hit.rank] ?? o.hit.rank }}</span>
              <span v-if="o.hit.count" class="block">{{ compact(o.hit.count) }}</span>
            </span>
          </template>
          <template v-else-if="o.kind === 'place-search'">
            <svg
              viewBox="0 0 24 24"
              class="size-4 text-subtle"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span class="text-muted">Search places for “{{ query.trim() }}”</span>
          </template>
          <template v-else>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-text">{{ o.place.name }}</span>
              <span v-if="o.place.detail" class="block truncate text-xs text-muted">{{ o.place.detail }}</span>
            </span>
          </template>
        </li>
      </ul>
      <p v-if="places && !places.length && !placeFailed" class="px-3 py-2 text-sm text-muted">No places found.</p>
      <p v-if="placeFailed" class="px-3 py-2 text-sm text-muted">Place search is unavailable right now.</p>
      <p v-if="liveFailed && !places" class="border-t border-border px-3 py-1.5 text-xs text-subtle">
        Live species search is busy; showing saved names only.
      </p>
    </div>
    <p class="sr-only" aria-live="polite">
      {{ open ? `${taxa.length} species result${taxa.length === 1 ? '' : 's'}` : '' }}
    </p>
  </div>
</template>

<style scoped>
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 3s;
  }
}
input[type='search']::-webkit-search-cancel-button {
  filter: grayscale(1);
}
</style>
