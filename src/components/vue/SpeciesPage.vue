<script setup lang="ts">
/**
 * Species page body, shared by the pre-rendered route (rendered at build,
 * no hydration) and the /species/view fallback (rendered in the browser).
 * Interactive parts (gallery, mini-map, similar species) come in through named slots so the
 * pre-rendered page can hydrate just those as islands.
 */
import { computed } from 'vue';
import { compact, full, RANK_LABELS } from '~/lib/format';
import type { SpeciesData } from '~/lib/species/data';
import RadialSeasonality from './RadialSeasonality.vue';
import UiIcon from './UiIcon.vue';

const props = defineProps<{ data: SpeciesData }>();

const speciesData = computed(() => props.data);
const displayName = computed(() => speciesData.value.commonName ?? speciesData.value.canonicalName);
const generated = computed(() => speciesData.value.generated.slice(0, 10));
const otherNames = computed(() =>
  speciesData.value.vernacular.filter((group) => group.code !== 'eng' && group.code !== 'en'),
);
const englishNames = computed(
  () => speciesData.value.vernacular.find((group) => group.code === 'eng' || group.code === 'en')?.names ?? [],
);
</script>

<template>
  <article class="species-page mx-auto max-w-6xl px-4 pb-8 pt-6 sm:px-6 sm:pb-16">
    <nav aria-label="Classification" class="mb-3 text-xs text-subtle">
      <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li v-for="(taxon, index) in speciesData.classification" :key="taxon.key" class="flex items-center gap-1.5">
          <a
            :href="`/tree?focus=${taxon.key}`"
            class="hover:text-text hover:underline"
            :title="RANK_LABELS[taxon.rank] ?? taxon.rank"
          >
            <span :class="taxon.rank === 'GENUS' ? 'sci-name' : ''">{{ taxon.name }}</span>
          </a>
          <span v-if="index < speciesData.classification.length - 1" aria-hidden="true">›</span>
        </li>
      </ol>
    </nav>

    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <h1 class="font-display text-4xl leading-tight sm:text-5xl" :class="{ 'sci-name': !speciesData.commonName }">
          {{ displayName }}
        </h1>
        <p class="mt-1 text-lg text-muted">
          <span class="sci-name text-text">{{ speciesData.canonicalName }}</span>
          <span v-if="speciesData.authorship" class="ml-1.5 text-sm">{{ speciesData.authorship }}</span>
        </p>
        <p class="mt-2 flex flex-wrap gap-2 text-xs">
          <span class="rounded-full border border-border px-2.5 py-0.5 text-muted">{{
            RANK_LABELS[speciesData.rank] ?? speciesData.rank
          }}</span>
          <span
            v-if="speciesData.status && speciesData.status !== 'ACCEPTED'"
            class="rounded-full border border-border px-2.5 py-0.5 text-muted"
          >
            {{ speciesData.status.toLowerCase() }}
          </span>
          <span class="rounded-full bg-accent-soft px-2.5 py-0.5 text-text">{{ full(speciesData.count) }} records</span>
        </p>
      </div>
      <div class="flex gap-2 text-sm">
        <a :href="`/?taxon=${speciesData.key}`" class="rounded-md bg-accent px-3 py-2 font-medium text-accent-contrast"
          >View on map</a
        >
        <a
          :href="`/tree?focus=${speciesData.key}`"
          class="rounded-md border border-border px-3 py-2 hover:border-accent"
          >Tree of life</a
        >
      </div>
    </header>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <slot name="gallery">
          <div class="grid aspect-[4/3] place-items-center rounded-lg bg-photo text-sm text-subtle">
            No openly licensed photos yet
          </div>
        </slot>
      </div>
      <div class="space-y-4">
        <slot name="map" />
        <section v-if="englishNames.length || speciesData.vernacular.length" aria-labelledby="names-h">
          <h2 id="names-h" class="mb-2 font-display text-xl">Common names</h2>
          <p v-if="englishNames.length" class="text-sm">{{ englishNames.join(' · ') }}</p>
          <details v-if="otherNames.length" class="mt-2 text-sm">
            <summary class="cursor-pointer text-muted hover:text-text">
              <UiIcon name="chevron-right" class="chevron" /> {{ otherNames.length }} other languages
            </summary>
            <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <template v-for="group in otherNames" :key="group.code">
                <dt class="text-subtle">{{ group.language }}</dt>
                <dd>{{ group.names.join(' · ') }}</dd>
              </template>
            </dl>
          </details>
        </section>
      </div>
    </div>

    <section v-if="speciesData.count > 0" class="mt-10" aria-labelledby="records-h">
      <h2 id="records-h" class="mb-4 font-display text-2xl">Records</h2>
      <div class="grid gap-8 md:grid-cols-2">
        <!-- Plot charts hydrate as islands (client:visible); see PlotChart.vue. -->
        <slot name="years" />
        <RadialSeasonality :counts="speciesData.months" :size="240" title="Records by month" />
        <slot name="countries" />
        <slot name="datasets" />
      </div>
    </section>
    <p v-else class="mt-10 rounded-md bg-surface-2 p-4 text-sm text-muted">
      GBIF has no occurrence records for this taxon yet.
    </p>

    <section v-if="speciesData.siblings.length" class="mt-10" aria-labelledby="similar-h">
      <h2 id="similar-h" class="mb-1 font-display text-2xl">Similar species</h2>
      <p class="mb-4 text-sm text-muted">
        Other species in the genus
        <span class="sci-name">{{ speciesData.classification.find((taxon) => taxon.rank === 'GENUS')?.name }}</span
        >, by records.
      </p>
      <!-- Cards hydrate as an island (SimilarSpecies), which looks up their photos. -->
      <slot name="similar" />
    </section>

    <section v-if="speciesData.synonyms.length" class="mt-10" aria-labelledby="syn-h">
      <h2 id="syn-h" class="mb-2 font-display text-xl">Synonyms</h2>
      <details class="text-sm">
        <summary class="cursor-pointer text-muted hover:text-text">
          <UiIcon name="chevron-right" class="chevron" /> {{ speciesData.synonyms.length }} names
        </summary>
        <ul class="mt-2 columns-1 gap-6 sm:columns-2">
          <li v-for="synonym in speciesData.synonyms" :key="synonym" class="sci-name py-0.5">{{ synonym }}</li>
        </ul>
      </details>
    </section>

    <footer class="mt-12 border-t border-border pt-4 text-xs text-subtle">
      Occurrence data from <a href="https://www.gbif.org">GBIF.org</a> and its data publishers ({{
        compact(speciesData.count)
      }}
      records, top datasets listed above). Photos are shown under their stated licences. Snapshot {{ generated }} ·
      <a :href="`https://www.gbif.org/species/${speciesData.key}`" target="_blank" rel="noopener"
        >GBIF species page <UiIcon name="external"
      /></a>
    </footer>
  </article>
</template>
