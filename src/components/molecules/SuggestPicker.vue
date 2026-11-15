<script lang="ts">
/** One value a picker offers, with its records under the other filters. */
export interface Suggestion {
  key: string;
  title: string;
  count: number;
}
</script>

<script setup lang="ts">
/**
 * A multi-select filter fed by a search (publishers, recorders): type to search, or
 * focus the empty box to list the biggest, and pick several. Each suggestion shows how
 * many records it has under the other filters. ARIA 1.2 combobox, as in TaxaPicker,
 * and the picked values in a SelectedList.
 */
import { computed, nextTick, onScopeDispose, ref, useId } from 'vue';
import { compact } from '~/lib/format';
import { debounce, SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';
import SearchInput from './SearchInput.vue';
import SelectedList from './SelectedList.vue';

const props = defineProps<{
  /** The field's label, e.g. "Publisher". */
  label: string;
  /** What the values are, lower case, e.g. "publishers". */
  plural: string;
  selected: readonly { key: string; name: string }[];
  max: number;
  search: (text: string, signal: AbortSignal) => Promise<Suggestion[]>;
  hint: string;
}>();

const emit = defineEmits<{ pick: [suggestion: Suggestion]; remove: [key: string]; clear: [] }>();

/** Shorter queries match most of GBIF, so they aren't sent. */
const MIN_QUERY_LENGTH = 2;

const uniqueId = useId();
const listId = `${uniqueId}-list`;

const query = ref('');
const suggestions = ref<Suggestion[]>([]);
const loading = ref(false);
const isFocused = ref(false);
const failed = ref(false);
const active = ref(-1);
let abort: AbortController | undefined;

const isFull = computed(() => props.selected.length >= props.max);
const options = computed(() => {
  const pickedKeys = new Set(props.selected.map((item) => item.key));
  return suggestions.value.filter((suggestion) => !pickedKeys.has(suggestion.key));
});
const isBrowsing = computed(() => isFocused.value && query.value.trim() === '');
const isOpen = computed(
  () => (isBrowsing.value || query.value.trim().length >= MIN_QUERY_LENGTH) && !isFull.value && !loading.value,
);
const activeId = computed(() => (active.value >= 0 ? `${uniqueId}-opt-${active.value}` : undefined));

const runSearch = debounce(async (text: string) => {
  const controller = new AbortController();
  abort = controller;
  try {
    suggestions.value = await props.search(text, controller.signal);
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

/** Start a search for the box's text; an empty focused box lists the biggest; else close the list. */
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
function pick(suggestion: Suggestion) {
  emit('pick', suggestion);
  query.value = '';
  onInput();
}

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
  <!-- min-w-0: a fieldset otherwise grows to fit its longest name instead of truncating it. -->
  <fieldset class="min-w-0">
    <div class="mb-1.5 flex items-baseline justify-between">
      <label :for="`${uniqueId}-input`" class="group-label">{{ label }}</label>
      <button v-if="selected.length" type="button" class="link-btn" @click="emit('clear')">Clear</button>
    </div>

    <SelectedList
      v-if="selected.length"
      class="mb-2"
      :items="selected"
      :label="`Selected ${plural}`"
      :remove-label="(item) => `Remove ${item.name}`"
      @remove="(key) => emit('remove', key)"
    >
      <template #default="{ item }">
        <span class="min-w-0 truncate font-medium" :title="item.name">{{ item.name }}</span>
      </template>
    </SelectedList>

    <div class="relative">
      <SearchInput
        :id="`${uniqueId}-input`"
        v-model="query"
        role="combobox"
        autocomplete="off"
        :placeholder="isFull ? `Up to ${max} at once` : `Search ${plural}`"
        :disabled="isFull"
        :loading="loading"
        :loading-label="`Looking up ${plural}`"
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

      <ul v-show="isOpen" :id="listId" role="listbox" class="options" :aria-label="`${label} suggestions`">
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
          {{ failed ? `Searching ${plural} is unavailable. Try again shortly.` : 'Nothing found' }}
        </li>
      </ul>
    </div>

    <p class="hint">{{ hint }}</p>
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
