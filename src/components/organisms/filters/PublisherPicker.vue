<script setup lang="ts">
/**
 * The How filter's publishers: search GBIF's publishing organisations by name
 * (the biggest by records are listed before anything is typed) and pick several, records from any of them shown. Each suggestion shows how
 * many records it has under the other filters; publishers with none there
 * aren't offered. ARIA 1.2 combobox, as in
 * TaxaPicker, and the picked publishers in the same SelectedList.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onScopeDispose, ref, useId } from 'vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import SelectedList from '~/components/molecules/SelectedList.vue';
import { compact } from '~/lib/format';
import { findPublishers, type PublisherHit } from '~/lib/gbif';
import { debounce, SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';
import { $occurrenceFilter } from '~/stores/explorer';
import {
  $publisherKeys,
  $publisherNames,
  addPublisher,
  MAX_PUBLISHERS,
  removePublisher,
  UNKNOWN_PUBLISHER,
} from '~/stores/publisher';

/** Shorter queries match most of GBIF's publishers, so they aren't sent. */
const MIN_QUERY_LENGTH = 2;

const uniqueId = useId();
const listId = `${uniqueId}-publisher-list`;

const keys = useStore($publisherKeys);
const names = useStore($publisherNames);
const selected = computed(() => keys.value.map((key) => ({ key, name: names.value[key] ?? UNKNOWN_PUBLISHER })));

const query = ref('');
const suggestions = ref<PublisherHit[]>([]);
const loading = ref(false);
const isFocused = ref(false);
const failed = ref(false);
const active = ref(-1);
let abort: AbortController | undefined;

const isFull = computed(() => keys.value.length >= MAX_PUBLISHERS);
const options = computed(() => suggestions.value.filter((suggestion) => !keys.value.includes(suggestion.key)));
const isBrowsing = computed(() => isFocused.value && query.value.trim() === '');
const isOpen = computed(
  () => (isBrowsing.value || query.value.trim().length >= MIN_QUERY_LENGTH) && !isFull.value && !loading.value,
);
const activeId = computed(() => (active.value >= 0 ? `${uniqueId}-opt-${active.value}` : undefined));

const runSearch = debounce(async (text: string) => {
  const controller = new AbortController();
  abort = controller;
  try {
    // Leave out the publisher filter itself, or only the picked publishers would match.
    const otherFilters = { ...$occurrenceFilter.get(), publishers: undefined };
    suggestions.value = await findPublishers(text, otherFilters, controller.signal);
  } catch (error) {
    // Aborted: a newer search has taken over.
    if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
    suggestions.value = [];
    failed.value = true;
  }
  loading.value = false;
}, SEARCH_DEBOUNCE_MS);

onScopeDispose(() => {
  runSearch.cancel();
  abort?.abort();
});

/** Start a search for the box's text; an empty focused box lists the top publishers; else close the list. */
function onInput() {
  active.value = -1;
  abort?.abort();
  failed.value = false;
  const text = query.value.trim();
  loading.value = isBrowsing.value || text.length >= MIN_QUERY_LENGTH;
  if (loading.value) runSearch(text);
  else runSearch.cancel();
}

/** Add a suggestion to the filter and empty the box for the next one. */
function pick(suggestion: PublisherHit) {
  addPublisher(suggestion);
  query.value = '';
  onInput();
}

const clearAll = () => $publisherKeys.set([]);

/** Move the highlighted option up or down, wrapping at the ends. */
function move(delta: number) {
  const count = options.value.length;
  if (!count) return;
  active.value = (active.value + delta + count) % count;
  nextTick(() => document.getElementById(activeId.value ?? '')?.scrollIntoView({ block: 'nearest' }));
}

/** Arrow keys move through the options, Enter picks one, Escape empties the box. */
function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    const suggestion = options.value[active.value] ?? (options.value.length === 1 ? options.value[0] : undefined);
    if (!suggestion) return;
    event.preventDefault();
    pick(suggestion);
  } else if (event.key === 'Escape' && query.value) {
    // Clear the search first; a second Escape closes the flyout.
    event.stopPropagation();
    query.value = '';
    onInput();
  }
}
</script>

<template>
  <!-- min-w-0: a fieldset otherwise grows to fit its longest publisher name instead of truncating it. -->
  <fieldset class="min-w-0">
    <div class="mb-1.5 flex items-baseline justify-between">
      <label :for="`${uniqueId}-input`" class="group-label">Publisher</label>
      <button v-if="keys.length" type="button" class="link-btn" @click="clearAll">Clear</button>
    </div>

    <SelectedList
      v-if="selected.length"
      class="mb-2"
      :items="selected"
      label="Selected publishers"
      :remove-label="(publisher) => `Remove ${publisher.name}`"
      @remove="removePublisher"
    >
      <template #default="{ item: publisher }">
        <span class="min-w-0 truncate font-medium" :title="publisher.name">{{ publisher.name }}</span>
      </template>
    </SelectedList>

    <div class="relative">
      <SearchInput
        :id="`${uniqueId}-input`"
        v-model="query"
        role="combobox"
        autocomplete="off"
        :placeholder="isFull ? `Up to ${MAX_PUBLISHERS} at once` : 'Search publishers'"
        :disabled="isFull"
        :loading="loading"
        loading-label="Looking up publishers"
        :aria-expanded="isOpen"
        :aria-controls="listId"
        aria-autocomplete="list"
        :aria-activedescendant="activeId"
        @input="onInput"
        @focus="
          isFocused = true;
          onInput();
        "
        @blur="isFocused = false"
        @keydown="onKey"
      />

      <ul v-show="isOpen" :id="listId" role="listbox" class="options" aria-label="Publisher suggestions">
        <li
          v-for="(suggestion, index) in options"
          :id="`${uniqueId}-opt-${index}`"
          :key="suggestion.key"
          role="option"
          class="option"
          :class="{ active: index === active }"
          :aria-selected="index === active"
          @mousedown.prevent
          @click="pick(suggestion)"
          @mousemove="active = index"
        >
          <span class="min-w-0">{{ suggestion.title }}</span>
          <span class="shrink-0 text-[0.6875rem] tabular-nums text-subtle">
            {{ compact(suggestion.count) }}<span class="sr-only"> records</span>
          </span>
        </li>
        <li v-if="!options.length" class="option-note" role="presentation">
          {{ failed ? 'Publisher search is unavailable. Try again shortly.' : 'Nothing found' }}
        </li>
      </ul>
    </div>

    <p class="hint">Shows records from any selected publisher. Counts follow your other filters.</p>
  </fieldset>
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
