<script setup lang="ts">
/**
 * The record list's species filter: an ARIA 1.2 combobox over the cell's species. Names already known
 * match as you type; the name search adds species named nowhere here yet. Picking a species sets the
 * model to its key; emptying the box sets it back to '' (all species).
 */
import { computed, ref, useId, watch } from 'vue';
import NameSkeleton from '~/components/atoms/NameSkeleton.vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import { useCellNameSearch } from '~/composables/useCellNameSearch';
import { useSettledQuery } from '~/composables/useSettledQuery';
import { normalise } from '~/lib/data/name-index';
import { full } from '~/lib/format';
import type { OccurrenceFilter } from '~/lib/gbif';
import type { SpeciesRow } from '~/lib/species/groups';
import type { RecordNames } from './useRecordNames';

const MAX_OPTIONS = 8;
const STEP_KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

const props = defineProps<{
  species: readonly SpeciesRow[];
  /** The area whose records are listed; changing it clears the box. */
  area: OccurrenceFilter | null;
  names: RecordNames;
}>();
/** The picked speciesKey, or '' for all species. */
const speciesKey = defineModel<number | ''>({ required: true });

const uniqueId = useId();
const query = ref('');
const isOpen = ref(false);
const activeIndex = ref(-1);
const nameSearch = useCellNameSearch({ query, species: () => props.species, area: () => props.area });

/** Whether a species' common or scientific name contains the typed text. */
function matchesQuery(row: SpeciesRow, needle: string) {
  if (!needle || nameSearch.matchedKeys.value.has(row.key)) return true;
  // Not the "Species 123" placeholder, which would match "sp".
  const scientific = props.names.hasScientificName(row) ? props.names.scientificNameOf(row) : undefined;
  return [props.names.commonNameOf(row), scientific].some(
    (name) => name !== undefined && normalise(name).includes(needle),
  );
}

const cellOptions = computed(() => {
  const needle = normalise(query.value);
  return props.species
    .filter((row) => matchesQuery(row, needle))
    .sort((left, right) => right.records - left.records)
    .slice(0, MAX_OPTIONS);
});
const options = computed(() => [...cellOptions.value, ...nameSearch.outside.value].slice(0, MAX_OPTIONS));
const activeId = computed(() => (activeIndex.value >= 0 ? `${uniqueId}-opt-${activeIndex.value}` : undefined));

// A request each, so typing names the options once it pauses.
const { settled: settledQuery, isSettling } = useSettledQuery(query);
watch([() => props.species, settledQuery, isOpen], async ([, text, open]) => {
  if (!open && !text.trim()) return;
  await props.names.nameOptions(cellOptions.value.map((option) => option.key));
});
const isNaming = computed(
  () =>
    props.names.pendingNames.value.size > 0 || nameSearch.loading.value || (!!query.value.trim() && isSettling.value),
);
const hasNoResults = computed(() => !!query.value.trim() && !options.value.length && !isNaming.value);
const showOptions = computed(() => isOpen.value && (options.value.length > 0 || hasNoResults.value));

// Another cell, area or filter: the picked species may not be there any more.
watch(
  () => JSON.stringify(props.area),
  () => (query.value = ''),
);

/** Picks a species (or none), closing the list. */
function pick(row: SpeciesRow | undefined) {
  speciesKey.value = row?.key ?? '';
  query.value = row ? props.names.labelOf(row) : '';
  isOpen.value = false;
  activeIndex.value = -1;
}

/** Typing reopens the list; emptying the box goes back to all species. */
function onInput() {
  isOpen.value = true;
  activeIndex.value = -1;
  if (!query.value.trim() && speciesKey.value !== '') speciesKey.value = '';
}

/** Moves the highlight with the arrow keys, wrapping at either end. */
function stepActive(delta: number) {
  isOpen.value = true;
  const count = options.value.length;
  if (count) activeIndex.value = (activeIndex.value + delta + count) % count;
}

/** Enter picks the highlighted option, or the only one. */
function pickActive(event: KeyboardEvent) {
  const count = options.value.length;
  const option = options.value[activeIndex.value] ?? (count === 1 ? options.value[0] : undefined);
  if (!option) return;
  event.preventDefault();
  pick(option);
}

/** Combobox keys: arrows move, Enter picks, Escape closes the list (and only the list). */
function onKey(event: KeyboardEvent) {
  const delta = STEP_KEYS[event.key];
  if (delta) {
    event.preventDefault();
    stepActive(delta);
  } else if (event.key === 'Enter' && isOpen.value) {
    pickActive(event);
  } else if (event.key === 'Escape' && isOpen.value) {
    event.stopPropagation();
    isOpen.value = false;
  }
}
</script>

<template>
  <div class="relative text-sm">
    <label :for="`${uniqueId}-input`" class="sr-only">Filter records by species</label>
    <SearchInput
      :id="`${uniqueId}-input`"
      v-model="query"
      :loading="isNaming"
      role="combobox"
      autocomplete="off"
      placeholder="Filter by species"
      :disabled="!species.length"
      :aria-expanded="showOptions"
      :aria-controls="`${uniqueId}-list`"
      aria-autocomplete="list"
      :aria-activedescendant="activeId"
      @focus="isOpen = true"
      @blur="isOpen = false"
      @input="onInput"
      @keydown="onKey"
    />
    <ul
      v-show="showOptions"
      :id="`${uniqueId}-list`"
      role="listbox"
      class="options absolute inset-x-0 z-10 shadow"
      aria-label="Species in this cell"
    >
      <li
        v-for="(option, index) in options"
        :id="`${uniqueId}-opt-${index}`"
        :key="option.key"
        role="option"
        class="option"
        :class="{ active: index === activeIndex }"
        :aria-selected="option.key === speciesKey"
        @mousedown.prevent="pick(option)"
      >
        <NameSkeleton v-if="nameSearch.namePendingKeys.value.has(option.key)" />
        <span v-else class="min-w-0 truncate" :class="{ 'sci-name': !names.commonNameOf(option) }">{{
          names.labelOf(option)
        }}</span>
        <span class="shrink-0 text-[0.6875rem] text-subtle tabular-nums">{{ full(option.records) }}</span>
      </li>
      <li v-if="hasNoResults" role="option" aria-disabled="true" class="option text-muted">No results found</li>
    </ul>
  </div>
</template>

<style scoped>
.options {
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
.option.active,
.option:hover {
  background: var(--surface-2);
}
</style>
