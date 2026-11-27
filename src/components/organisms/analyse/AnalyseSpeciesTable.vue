<script setup lang="ts">
/**
 * Analyse's species picker: the starting list, narrowed as you type. Enter searches every species in GBIF
 * through the shared name search. Each row opens the species in Migration or Spread.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import SpeciesThumb from '~/components/molecules/SpeciesThumb.vue';
import { useLeadPhotos } from '~/composables/useLeadPhotos';
import { useNameSearch } from '~/composables/useNameSearch';
import { useScrollFade } from '~/composables/useScrollFade';
import { filterStartingSpecies, STARTING_SPECIES, type AnalyseTag } from '~/lib/analyse/starting-species';
import { analyseSpecies } from '~/stores/analyse';

/** A row: a starting species, or a GBIF search hit (which has no tags). */
interface PickerRow {
  key: number;
  commonName: string | undefined;
  scientificName: string;
  tags: readonly AnalyseTag[];
}

const MAX_SEARCH_HITS = 20;
/** Ranks a pattern can be drawn for: a species, or a subspecies when that's what the name finds. */
const ANALYSABLE_RANKS = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM']);

const TAG_DOTS: Record<AnalyseTag, string> = {
  Migrates: 'var(--ramp-4)',
  Introduced: 'var(--range-introduced)',
  Invasive: 'var(--range-invasive)',
};

const query = ref('');
/** The text Enter searched GBIF for; null while the starting list is showing. */
const searchedText = ref<string | null>(null);
const { hits, loading, search, settle, reset } = useNameSearch({ max: MAX_SEARCH_HITS });

const listRows = computed(() => filterStartingSpecies(query.value));
const searchRows = computed<PickerRow[]>(() =>
  hits.value
    .filter((hit) => ANALYSABLE_RANKS.has(hit.rank))
    .map((hit) => ({ key: hit.key, commonName: hit.commonName, scientificName: hit.scientificName, tags: [] })),
);
const isSearching = computed(() => searchedText.value !== null);
const rows = computed<readonly PickerRow[]>(() => (isSearching.value ? searchRows.value : listRows.value));

const { images, commonNames, isPending } = useLeadPhotos(() => rows.value.map((row) => row.key));

const scroller = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFades } = useScrollFade(scroller);
onMounted(updateFades);
watch(rows, () => nextTick(updateFades));

const countLabel = computed(() => {
  if (isSearching.value) return `${rows.value.length} found in GBIF`;
  if (rows.value.length === STARTING_SPECIES.length) return `${rows.value.length} species`;
  return `${rows.value.length} of ${STARTING_SPECIES.length} species`;
});

// Typing again goes back to narrowing the starting list.
watch(query, (text) => {
  if (text === searchedText.value) return;
  searchedText.value = null;
  reset();
});

/** Enter: searches every species in GBIF for the typed text. */
async function searchGbif() {
  const text = query.value.trim();
  if (!text) return;
  searchedText.value = query.value;
  search(text);
  await settle();
}

/** The name a row leads with: its common name if it has one. */
function displayName(row: PickerRow): string {
  return row.commonName ?? commonNames.value.get(row.key) ?? row.scientificName;
}
</script>

<template>
  <!-- The panel's height on wider screens, so the list scrolls inside it; most of the screen in the phone sheet. -->
  <div class="flex flex-col gap-3 sm:h-full">
    <p class="text-sm text-muted">
      Pick a species, then show how its records move through the year (Migration) or how it has spread across years
      (Spread).
    </p>

    <SearchInput
      v-model="query"
      :loading="loading"
      placeholder="Filter by name, or try “bird”"
      aria-label="Filter species"
      @keydown.enter.prevent="searchGbif"
    />

    <p class="-mt-1 text-xs text-subtle tabular-nums" aria-live="polite">{{ countLabel }}</p>

    <div class="species-box flex min-h-0 flex-1 flex-col rounded-md border border-border">
      <ul
        v-if="rows.length"
        ref="scroller"
        aria-label="Species"
        class="fade-list min-h-48 flex-1 overflow-y-auto overscroll-contain"
        :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
        @scroll.passive="updateFades"
      >
        <li
          v-for="row in rows"
          :key="row.key"
          class="flex items-center gap-2.5 border-b border-border py-2 pr-2 pl-3 last:border-b-0"
        >
          <SpeciesThumb
            :image="images.get(row.key)"
            :pending="isPending(row.key)"
            :name="displayName(row)"
            class="size-11"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ displayName(row) }}</span>
            <span
              v-if="displayName(row) !== row.scientificName"
              class="sci-name block truncate text-[0.8125rem] text-muted"
            >
              {{ row.scientificName }}
            </span>
            <span v-if="row.tags.length" class="mt-0.5 flex gap-2.5 text-[0.6875rem] whitespace-nowrap text-subtle">
              <span v-for="tag in row.tags" :key="tag" class="inline-flex items-center gap-1">
                <span class="size-1.5 rounded-full" :style="{ background: TAG_DOTS[tag] }" aria-hidden="true" />
                {{ tag }}
              </span>
            </span>
          </span>
          <span class="show-buttons flex h-8 flex-none overflow-hidden rounded-sm border border-border text-xs">
            <button
              type="button"
              class="px-2.5 hover:bg-surface-2"
              :aria-label="`Show migration for ${displayName(row)}`"
              @click="analyseSpecies(row.key, 'migration')"
            >
              Migration
            </button>
            <span class="my-1.5 w-px bg-border" aria-hidden="true" />
            <button
              type="button"
              class="px-2.5 hover:bg-surface-2"
              :aria-label="`Show spread for ${displayName(row)}`"
              @click="analyseSpecies(row.key, 'spread')"
            >
              Spread
            </button>
          </span>
        </li>
      </ul>

      <div v-else-if="!loading" class="flex flex-1 flex-col gap-1 px-3 py-4 text-[0.8125rem]">
        <template v-if="isSearching">
          <span>No species in GBIF match “{{ searchedText }}”.</span>
        </template>
        <template v-else>
          <span>No species in this list match “{{ query }}”.</span>
          <span class="text-subtle">Press Enter to search every species in GBIF.</span>
        </template>
      </div>

      <p v-if="!isSearching" class="border-t border-border px-3 py-2.5 text-[0.6875rem] text-subtle">
        Picked to show a migration or a spread. Type any name and press Enter to search every species in GBIF.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* About the full-height sheet's body, less the search, as Near me's lists. */
@media (max-width: 639px) {
  .species-box {
    flex: none;
    height: 75dvh;
  }
}

/* Tall enough to tap on phones. */
@media (pointer: coarse) {
  .show-buttons {
    height: 2.75rem;
  }
}
</style>
