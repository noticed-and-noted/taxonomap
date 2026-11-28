<script setup lang="ts">
/** One species in Analyse's picker: photo, names, tags, and the joined Migration | Spread button that opens it. */
import SpeciesThumb from '~/components/molecules/SpeciesThumb.vue';
import type { AnalyseTag } from '~/lib/analyse/starting-species';
import type { UsableImage } from '~/lib/gbif';
import { analyseSpecies } from '~/stores/analyse';

defineProps<{
  speciesKey: number;
  /** The name the row leads with: the common name when there is one. */
  name: string;
  scientificName: string;
  tags: readonly AnalyseTag[];
  image: UsableImage | undefined;
  isPhotoPending: boolean;
}>();

const TAG_DOTS: Record<AnalyseTag, string> = {
  Migrates: 'var(--ramp-4)',
  'Partly migrates': 'var(--ramp-4)',
  Introduced: 'var(--range-introduced)',
  Invasive: 'var(--range-invasive)',
};
</script>

<template>
  <li class="flex flex-wrap items-center gap-2.5 border-b border-border py-2 pr-2 pl-3 last:border-b-0">
    <SpeciesThumb :image="image" :pending="isPhotoPending" :name="name" class="size-11" />
    <span class="min-w-32 flex-1">
      <span class="block truncate text-sm">{{ name }}</span>
      <span v-if="name !== scientificName" class="sci-name block truncate text-[0.8125rem] text-muted">
        {{ scientificName }}
      </span>
      <span v-if="tags.length" class="mt-0.5 flex flex-wrap gap-x-2.5 text-[0.6875rem] text-subtle">
        <span v-for="tag in tags" :key="tag" class="inline-flex items-center gap-1">
          <span class="size-1.5 rounded-full" :style="{ background: TAG_DOTS[tag] }" aria-hidden="true" />
          {{ tag }}
        </span>
      </span>
    </span>
    <span class="show-buttons ml-auto flex h-8 flex-none overflow-hidden rounded-sm border border-border text-xs">
      <button
        type="button"
        class="px-2.5 hover:bg-surface-2"
        :aria-label="`Show migration for ${name}`"
        @click="analyseSpecies(speciesKey, 'migration')"
      >
        Migration
      </button>
      <span class="my-1.5 w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        class="px-2.5 hover:bg-surface-2"
        :aria-label="`Show spread for ${name}`"
        @click="analyseSpecies(speciesKey, 'spread')"
      >
        Spread
      </button>
    </span>
  </li>
</template>

<style scoped>
/* Tall enough to tap on phones. */
@media (pointer: coarse) {
  .show-buttons {
    height: 2.75rem;
  }
}
</style>
