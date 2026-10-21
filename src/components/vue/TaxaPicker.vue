<script setup lang="ts">
/**
 * The What filter's taxa: species or groups of any rank, records of any of
 * them shown. Suggestions come from the baked name index (instant) and GBIF
 * suggest / vernacular search (debounced), as in the header search, which
 * adds to the same list. ARIA 1.2 combobox; the listbox floats over the
 * content below and scrolls.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { loadNameIndex } from '~/lib/data/name-index';
import { compact, RANK_LABELS } from '~/lib/format';
import type { NameHit } from '~/lib/gbif';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import { $taxonKeys, MAX_TAXA } from '~/stores/explorer';
import { markDone } from '~/stores/onboarding';
import { $taxa, addTaxon, removeTaxon, taxonFromHit } from '~/stores/taxon';
import UiIcon from './UiIcon.vue';
import { useNameSearch } from './useNameSearch';

const MAX_OPTIONS = 20;
/** Past this many selected taxa, the list scrolls instead of growing. */
const SCROLL_AFTER = 5;
const uniqueId = useId();
const listId = `${uniqueId}-taxa-list`;

const keys = useStore($taxonKeys);
const taxa = useStore($taxa);
const manifest = useStore($speciesManifest);
const list = ref<HTMLUListElement>();

// The list is sorted by key, so a newly added taxon (here or from the header
// search) can land out of view once it scrolls; bring it into view.
watch(keys, async (next, prev) => {
  const added = next.find((addedKey) => !prev.includes(addedKey));
  if (added === undefined) return;
  await nextTick();
  list.value?.querySelector(`[data-key="${added}"]`)?.scrollIntoView({ block: 'nearest' });
});

const query = ref('');
const active = ref(-1);
const { hits: options, loading, search } = useNameSearch({ max: MAX_OPTIONS, exclude: () => keys.value });

const full = computed(() => keys.value.length >= MAX_TAXA);

const open = computed(() => query.value.trim().length >= 2 && !full.value);
const activeId = computed(() => (active.value >= 0 ? `${uniqueId}-opt-${active.value}` : undefined));
const rankLabel = (rank: string) => RANK_LABELS[rank] ?? (rank === 'UNRANKED' ? '' : rank.toLowerCase());

function onInput() {
  active.value = -1;
  search(query.value);
}

function pick(hit: NameHit) {
  if (addTaxon(taxonFromHit(hit)) !== 'full') markDone('group');
  query.value = '';
  onInput();
}

const clearAll = () => $taxonKeys.set([]);

function move(delta: number) {
  const count = options.value.length;
  if (!count) return;
  active.value = (active.value + delta + count) % count;
  nextTick(() => document.getElementById(activeId.value ?? '')?.scrollIntoView({ block: 'nearest' }));
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter') {
    const hit = options.value[active.value] ?? (options.value.length === 1 ? options.value[0] : undefined);
    if (hit) {
      event.preventDefault();
      pick(hit);
    }
  } else if (event.key === 'Escape' && query.value) {
    // Clear the search first; a second Escape closes the flyout.
    event.stopPropagation();
    query.value = '';
    onInput();
  }
}
</script>

<template>
  <div class="taxa-picker">
    <div class="mb-1.5 flex items-baseline justify-between">
      <label :for="`${uniqueId}-input`" class="group-label">
        Species and groups<span v-if="taxa.length > SCROLL_AFTER" class="tabular-nums"> ({{ taxa.length }})</span>
      </label>
      <button v-if="taxa.length" type="button" class="link-btn" @click="clearAll">Clear</button>
    </div>

    <ul
      v-if="taxa.length"
      ref="list"
      class="selected-list mb-2 space-y-1"
      :class="{ scrolls: taxa.length > SCROLL_AFTER }"
      :aria-label="`Selected taxa (${taxa.length})`"
    >
      <li v-for="taxon in taxa" :key="taxon.key" :data-key="taxon.key" class="selected-row">
        <span class="min-w-0 truncate">
          <a
            :href="speciesPath(taxon.key, manifest)"
            class="taxon-link"
            :class="taxon.commonName ? 'font-medium' : 'sci-name'"
            :title="`About ${taxon.commonName ?? taxon.scientificName}`"
            >{{ taxon.commonName ?? taxon.scientificName }}</a
          >
          <span v-if="taxon.commonName" class="sci-name ml-1 text-xs text-muted">{{ taxon.scientificName }}</span>
        </span>
        <span class="ml-auto shrink-0 text-[11px] text-subtle">{{ rankLabel(taxon.rank) }}</span>
        <button
          type="button"
          class="remove-btn"
          :aria-label="`Remove ${taxon.commonName ?? taxon.scientificName}`"
          @click="removeTaxon(taxon.key)"
        >
          <UiIcon name="close" size="0.875rem" />
        </button>
      </li>
    </ul>
    <p v-else class="mb-2 text-muted">All life.</p>

    <div class="relative">
      <input
        :id="`${uniqueId}-input`"
        v-model="query"
        type="search"
        class="picker-input"
        role="combobox"
        autocomplete="off"
        :placeholder="full ? `Up to ${MAX_TAXA} at once` : 'Add a species or group'"
        :disabled="full"
        :aria-expanded="open"
        :aria-controls="listId"
        aria-autocomplete="list"
        :aria-activedescendant="activeId"
        @focus="loadNameIndex"
        @input="onInput"
        @keydown="onKey"
      />

      <ul v-show="open" :id="listId" role="listbox" class="options" aria-label="Species and group suggestions">
        <li
          v-for="(hit, index) in options"
          :id="`${uniqueId}-opt-${index}`"
          :key="hit.key"
          role="option"
          class="option"
          :class="{ active: index === active }"
          :aria-selected="index === active"
          @mousedown.prevent
          @click="pick(hit)"
          @mousemove="active = index"
        >
          <span class="min-w-0 truncate">
            <span v-if="hit.commonName" class="font-medium">{{ hit.commonName }}</span>
            <span class="sci-name text-muted" :class="{ 'ml-1 text-xs': hit.commonName }">{{
              hit.scientificName
            }}</span>
          </span>
          <span class="shrink-0 text-right text-[11px] leading-tight text-subtle">
            <span class="block">{{ rankLabel(hit.rank) }}</span>
            <span v-if="hit.count" class="block tabular-nums">{{ compact(hit.count) }}</span>
          </span>
        </li>
        <li v-if="!options.length" class="option-note" role="presentation">
          {{ loading ? 'Searching…' : 'Nothing found' }}
        </li>
      </ul>
    </div>

    <p class="hint">Shows records of any selected species or group. The search at the top adds here too.</p>
  </div>
</template>

<style scoped>
.group-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
}

.hint {
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-subtle);
}

.link-btn {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.link-btn:hover {
  color: var(--text);
  text-decoration: underline;
}

/* About five and a half rows (2rem each, 0.25rem apart): the cut-off row shows there is more. */
.selected-list.scrolls {
  max-height: 12.25rem;
  overflow-y: auto;
  padding-right: 0.25rem;
  scrollbar-width: thin;
}

.selected-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  padding: 0 0.25rem 0 0.625rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}

.taxon-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.remove-btn {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  font-size: 1rem;
  line-height: 1;
  color: var(--text-muted);
}
.remove-btn:hover {
  color: var(--text);
  background: var(--surface-3);
}

.picker-input {
  width: 100%;
  height: 2rem;
  padding: 0 0.625rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.picker-input:hover {
  border-color: var(--border-strong);
}
.picker-input:disabled {
  opacity: 0.6;
}

.options {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  max-height: 16rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin-top: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
}

.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.option.active {
  background: var(--surface-2);
}

.option-note {
  padding: 0.375rem 0.5rem;
  color: var(--text-subtle);
}
</style>
