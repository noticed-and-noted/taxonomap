<script setup lang="ts">
/**
 * Filter chips: selected taxon, basis of record (multi), has photo.
 * Every chip writes a URL-synced store.
 */
import { useStore } from '@nanostores/vue';
import { computed, ref } from 'vue';
import { BASIS_LABELS } from '~/lib/format';
import type { BasisOfRecord } from '~/lib/gbif';
import { $basisOfRecord, $hasPhoto, $taxonKey, BASIS_OF_RECORD, clearHexSelection } from '~/stores/explorer';
import { $taxonInfo } from '~/stores/taxon';

const props = withDefaults(defineProps<{ parts?: 'all' | 'taxon' | 'filters'; stacked?: boolean }>(), {
  parts: 'all',
  stacked: false,
});
const showTaxon = props.parts !== 'filters';
const showFilters = props.parts !== 'taxon';

const taxon = useStore($taxonInfo);
const basis = useStore($basisOfRecord);
const photo = useStore($hasPhoto);

const basisOpen = ref(false);

const basisLabel = computed(() => {
  if (!basis.value.length) return 'Any record type';
  if (basis.value.length === 1) return BASIS_LABELS[basis.value[0] as string] ?? basis.value[0];
  return `${basis.value.length} record types`;
});

function toggleBasis(b: BasisOfRecord) {
  const next = basis.value.includes(b) ? basis.value.filter((x) => x !== b) : [...basis.value, b];
  $basisOfRecord.set(next.sort());
}

// Vue does not expose $-prefixed setup bindings to templates in dev mode.
const clearBasis = () => $basisOfRecord.set([]);
const togglePhoto = () => $hasPhoto.set(!photo.value);

function clearTaxon() {
  clearHexSelection();
  $taxonKey.set(null);
}

function onBasisKey(e: KeyboardEvent) {
  if (e.key === 'Escape') basisOpen.value = false;
}

function onBasisBlur(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (!next || !(e.currentTarget as HTMLElement).contains(next)) basisOpen.value = false;
}
</script>

<template>
  <div
    class="filter-chips flex gap-2"
    :class="stacked ? 'flex-col items-start' : 'flex-wrap items-center'"
    role="group"
    :aria-label="showFilters ? 'Filters' : 'Selected taxon'"
  >
    <span v-if="showTaxon && taxon" class="chip chip-active max-w-[18rem]">
      <span class="min-w-0 truncate">
        <span v-if="taxon.commonName" class="font-medium">{{ taxon.commonName }}</span>
        <span class="sci-name" :class="taxon.commonName ? 'ml-1 text-xs opacity-80' : ''">{{
          taxon.scientificName
        }}</span>
      </span>
      <button
        type="button"
        class="chip-x"
        :aria-label="`Remove taxon filter ${taxon.commonName ?? taxon.scientificName}`"
        @click="clearTaxon"
      >
        ×
      </button>
    </span>

    <template v-if="showFilters">
      <div class="relative" @focusout="onBasisBlur" @keydown="onBasisKey">
        <button
          type="button"
          class="chip"
          :class="{ 'chip-active': basis.length }"
          aria-haspopup="true"
          :aria-expanded="basisOpen"
          aria-controls="basis-menu"
          @click="basisOpen = !basisOpen"
        >
          {{ basisLabel }}
          <svg viewBox="0 0 12 12" class="size-3" aria-hidden="true">
            <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        <fieldset
          v-show="basisOpen"
          id="basis-menu"
          class="absolute left-0 top-full z-30 mt-1 w-60 rounded-md border border-border bg-surface p-2 shadow-panel"
        >
          <legend class="sr-only">Basis of record</legend>
          <label
            v-for="b in BASIS_OF_RECORD"
            :key="b"
            class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-2"
          >
            <input
              type="checkbox"
              class="accent-[var(--accent)]"
              :checked="basis.includes(b)"
              @change="toggleBasis(b)"
            />
            {{ BASIS_LABELS[b] }}
          </label>
          <button
            v-if="basis.length"
            type="button"
            class="mt-1 w-full rounded-sm px-2 py-1 text-left text-xs text-muted hover:text-text"
            @click="clearBasis"
          >
            Clear
          </button>
        </fieldset>
      </div>

      <button type="button" class="chip" :class="{ 'chip-active': photo }" :aria-pressed="photo" @click="togglePhoto">
        <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="3" y="6" width="18" height="14" rx="2" />
          <circle cx="12" cy="13" r="3.5" />
          <path d="M8 6l1.5-2h5L16 6" />
        </svg>
        Has photo
      </button>
    </template>
  </div>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
  box-shadow: var(--shadow);
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}

.chip:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.chip-active {
  color: var(--text);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}

.chip-x {
  display: grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  margin-right: -0.375rem;
  border-radius: 50%;
  font-size: 1rem;
  line-height: 1;
}

.chip-x:hover {
  background: var(--surface-3);
}
</style>
