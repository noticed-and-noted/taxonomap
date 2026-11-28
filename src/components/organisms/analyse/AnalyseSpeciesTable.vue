<script setup lang="ts">
/**
 * Analyse's species picker. Empty, it suggests the hand-picked starting list; typing narrows that list and, through
 * the shared name search, finds more species in GBIF below it. Each row opens the species in Migration or Spread.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import { useLeadPhotos } from '~/composables/useLeadPhotos';
import { useNameSearch } from '~/composables/useNameSearch';
import { useScrollFade } from '~/composables/useScrollFade';
import { migrationTags } from '~/lib/analyse/migration';
import { filterStartingSpecies, STARTING_SPECIES, type AnalyseTag } from '~/lib/analyse/starting-species';
import AnalyseSpeciesRow from './AnalyseSpeciesRow.vue';

/** A row: a starting species, or a GBIF search hit. */
interface PickerRow {
  key: number;
  commonName: string | undefined;
  scientificName: string;
  tags: readonly AnalyseTag[];
}

const MAX_SEARCH_HITS = 20;
/** Ranks a pattern can be drawn for: a species, or a subspecies when that's what the name finds. */
const ANALYSABLE_RANKS = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM']);

const query = ref('');
const { hits, loading, failed, answered, search, settle } = useNameSearch({ max: MAX_SEARCH_HITS });
watch(query, (text) => search(text));

const pickedRows = computed<readonly PickerRow[]>(() => filterStartingSpecies(query.value));
const isTyping = computed(() => query.value.trim() !== '');

/** Migration tags for search hits, from the EOL table (the starting list's tags are picked by hand). */
const searchTags = ref(new Map<number, AnalyseTag>());
/** GBIF's hits for the typed text, less the species the starting list already shows. */
const gbifRows = computed<PickerRow[]>(() => {
  if (!isTyping.value) return [];
  const picked = new Set(pickedRows.value.map((row) => row.key));
  return hits.value
    .filter((hit) => ANALYSABLE_RANKS.has(hit.rank) && !picked.has(hit.key))
    .map((hit) => {
      const tag = searchTags.value.get(hit.key);
      return { key: hit.key, commonName: hit.commonName, scientificName: hit.scientificName, tags: tag ? [tag] : [] };
    });
});

/** Keys already looked up, so new tags (which rebuild the rows) don't start the lookup again. */
const taggedKeys = new Set<number>();
watch(
  () => hits.value.map((hit) => hit.key).join(),
  async () => {
    const keys = hits.value.map((hit) => hit.key).filter((key) => !taggedKeys.has(key));
    if (!keys.length) return;
    for (const key of keys) taggedKeys.add(key);
    // Without the table the rows still work, just untagged.
    const found = await migrationTags(keys).catch(() => undefined);
    if (found?.size) searchTags.value = new Map([...searchTags.value, ...found]);
  },
);

const allRows = computed(() => [...pickedRows.value, ...gbifRows.value]);
const { images, commonNames, isPending } = useLeadPhotos(() => allRows.value.map((row) => row.key));

const scroller = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFades } = useScrollFade(scroller);
onMounted(updateFades);
watch(allRows, () => nextTick(updateFades));

const countLabel = computed(() => {
  const picked = pickedRows.value.length;
  if (!isTyping.value) return `${picked} picked species`;
  const pickedText = `${picked} of ${STARTING_SPECIES.length} picked`;
  return gbifRows.value.length ? `${pickedText} · ${gbifRows.value.length} more in GBIF` : pickedText;
});
/** GBIF is searched from this many letters (as the shared name search does). */
const MIN_SEARCH_LENGTH = 2;
/** GBIF has answered the typed text (or failed, or wasn't asked), so an empty list means no matches. */
const isSettled = computed(
  () =>
    query.value.trim().length < MIN_SEARCH_LENGTH || failed.value || (answered.value === query.value && !loading.value),
);

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
      placeholder="Search any species, or try “bird”"
      aria-label="Search species"
      @keydown.enter.prevent="settle"
    />

    <p class="-mt-1 text-xs text-subtle tabular-nums" aria-live="polite">{{ countLabel }}</p>

    <div class="species-box flex min-h-0 flex-1 flex-col rounded-md border border-border">
      <div
        v-if="allRows.length"
        ref="scroller"
        class="fade-list min-h-48 flex-1 overflow-y-auto overscroll-contain"
        :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
        @scroll.passive="updateFades"
      >
        <ul v-if="pickedRows.length" aria-label="Species">
          <AnalyseSpeciesRow
            v-for="row in pickedRows"
            :key="row.key"
            :species-key="row.key"
            :name="displayName(row)"
            :scientific-name="row.scientificName"
            :tags="row.tags"
            :image="images.get(row.key)"
            :is-photo-pending="isPending(row.key)"
          />
        </ul>
        <section v-if="gbifRows.length" aria-labelledby="more-in-gbif">
          <h3
            id="more-in-gbif"
            class="border-b border-border bg-surface-2 px-3 py-1.5 font-sans text-xs font-normal text-subtle"
            :class="{ 'border-t': pickedRows.length }"
          >
            More species in GBIF
          </h3>
          <ul aria-label="More species in GBIF">
            <AnalyseSpeciesRow
              v-for="row in gbifRows"
              :key="row.key"
              :species-key="row.key"
              :name="displayName(row)"
              :scientific-name="row.scientificName"
              :tags="row.tags"
              :image="images.get(row.key)"
              :is-photo-pending="isPending(row.key)"
            />
          </ul>
        </section>
      </div>

      <p v-else-if="isSettled" class="flex-1 px-3 py-4 text-[0.8125rem]">No species match “{{ query }}”.</p>
      <p v-else class="flex-1 px-3 py-4 text-[0.8125rem] text-subtle">Searching GBIF…</p>

      <p class="border-t border-border px-3 py-2.5 text-[0.6875rem] text-subtle">
        <template v-if="gbifRows.length">
          Migrates for species from GBIF comes from trait data gathered by the
          <a href="https://eol.org" target="_blank" rel="noopener">Encyclopedia of Life</a>: Animal Diversity Web, Sibly
          et al. (2012) and Polytraits.
        </template>
        <template v-else
          >Picked to show a migration or a spread. Type any name to search every species in GBIF.</template
        >
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
</style>
