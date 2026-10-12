<script setup lang="ts">
/**
 * Species page body, shared by the pre-rendered route (rendered at build,
 * no hydration) and the /species/view fallback (rendered in the browser).
 * Interactive parts (gallery, mini-map) come in through named slots so the
 * pre-rendered page can hydrate just those as islands.
 */
import { computed } from 'vue';
import { compact, full, RANK_LABELS } from '~/lib/format';
import type { SpeciesData } from '~/lib/species/data';
import { speciesPath, type SpeciesManifest } from '~/lib/species/links';
import RadialSeasonality from './RadialSeasonality.vue';
import SpeciesCard from './SpeciesCard.vue';

const props = defineProps<{ data: SpeciesData; manifest?: SpeciesManifest | null }>();

const d = computed(() => props.data);
const displayName = computed(() => d.value.commonName ?? d.value.canonicalName);
const generated = computed(() => d.value.generated.slice(0, 10));
const otherNames = computed(() => d.value.vernacular.filter((g) => g.code !== 'eng' && g.code !== 'en'));
const englishNames = computed(() => d.value.vernacular.find((g) => g.code === 'eng' || g.code === 'en')?.names ?? []);
</script>

<template>
  <article class="species-page mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
    <nav aria-label="Classification" class="mb-3 text-xs text-subtle">
      <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li v-for="(t, i) in d.classification" :key="t.key" class="flex items-center gap-1.5">
          <a
            :href="`/tree?focus=${t.key}`"
            class="hover:text-text hover:underline"
            :title="RANK_LABELS[t.rank] ?? t.rank"
          >
            <span :class="t.rank === 'GENUS' ? 'sci-name' : ''">{{ t.name }}</span>
          </a>
          <span v-if="i < d.classification.length - 1" aria-hidden="true">›</span>
        </li>
      </ol>
    </nav>

    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <h1 class="font-display text-4xl leading-tight sm:text-5xl" :class="{ 'sci-name': !d.commonName }">
          {{ displayName }}
        </h1>
        <p class="mt-1 text-lg text-muted">
          <span class="sci-name text-text">{{ d.canonicalName }}</span>
          <span v-if="d.authorship" class="ml-1.5 text-sm">{{ d.authorship }}</span>
        </p>
        <p class="mt-2 flex flex-wrap gap-2 text-xs">
          <span class="rounded-full border border-border px-2.5 py-0.5 text-muted">{{
            RANK_LABELS[d.rank] ?? d.rank
          }}</span>
          <span
            v-if="d.status && d.status !== 'ACCEPTED'"
            class="rounded-full border border-border px-2.5 py-0.5 text-muted"
          >
            {{ d.status.toLowerCase() }}
          </span>
          <span class="rounded-full bg-accent-soft px-2.5 py-0.5 text-text">{{ full(d.count) }} records</span>
        </p>
      </div>
      <div class="flex gap-2 text-sm">
        <a :href="`/?taxon=${d.key}`" class="rounded-md bg-accent px-3 py-2 font-medium text-accent-contrast"
          >View on map</a
        >
        <a
          :href="`/tree?focus=${d.key}&taxon=${d.key}`"
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
        <section v-if="englishNames.length || d.vernacular.length" aria-labelledby="names-h">
          <h2 id="names-h" class="mb-2 font-display text-xl">Common names</h2>
          <p v-if="englishNames.length" class="text-sm">{{ englishNames.join(' · ') }}</p>
          <details v-if="otherNames.length" class="mt-2 text-sm">
            <summary class="cursor-pointer text-muted hover:text-text">{{ otherNames.length }} other languages</summary>
            <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <template v-for="g in otherNames" :key="g.code">
                <dt class="text-subtle">{{ g.language }}</dt>
                <dd>{{ g.names.join(' · ') }}</dd>
              </template>
            </dl>
          </details>
        </section>
      </div>
    </div>

    <section v-if="d.count > 0" class="mt-10" aria-labelledby="records-h">
      <h2 id="records-h" class="mb-4 font-display text-2xl">Records</h2>
      <div class="grid gap-8 md:grid-cols-2">
        <!-- Plot charts hydrate as islands (client:visible); see PlotChart.vue. -->
        <slot name="years" />
        <RadialSeasonality :counts="d.months" :size="240" title="Records by month" />
        <slot name="countries" />
        <slot name="datasets" />
      </div>
    </section>
    <p v-else class="mt-10 rounded-md bg-surface-2 p-4 text-sm text-muted">
      GBIF has no occurrence records for this taxon yet.
    </p>

    <section v-if="d.siblings.length" class="mt-10" aria-labelledby="similar-h">
      <h2 id="similar-h" class="mb-1 font-display text-2xl">Similar species</h2>
      <p class="mb-4 text-sm text-muted">
        Other species in the genus
        <span class="sci-name">{{ d.classification.find((c) => c.rank === 'GENUS')?.name }}</span
        >, by records.
      </p>
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <li v-for="s in d.siblings" :key="s.key">
          <SpeciesCard
            :species-key="s.key"
            :scientific-name="s.scientificName"
            :common-name="s.commonName"
            :count="s.count"
            :image="s.image"
            size="400x"
            :href="speciesPath(s.key, manifest)"
          />
        </li>
      </ul>
    </section>

    <section v-if="d.synonyms.length" class="mt-10" aria-labelledby="syn-h">
      <h2 id="syn-h" class="mb-2 font-display text-xl">Synonyms</h2>
      <details class="text-sm">
        <summary class="cursor-pointer text-muted hover:text-text">{{ d.synonyms.length }} names</summary>
        <ul class="mt-2 columns-1 gap-6 sm:columns-2">
          <li v-for="s in d.synonyms" :key="s" class="sci-name py-0.5">{{ s }}</li>
        </ul>
      </details>
    </section>

    <footer class="mt-12 border-t border-border pt-4 text-xs text-subtle">
      Occurrence data from <a href="https://www.gbif.org" class="underline">GBIF.org</a> and its data publishers ({{
        compact(d.count)
      }}
      records, top datasets listed above). Photos are shown under their stated licences. Snapshot {{ generated }} ·
      <a :href="`https://www.gbif.org/species/${d.key}`" class="underline" target="_blank" rel="noopener"
        >GBIF species page ↗</a
      >
    </footer>
  </article>
</template>
