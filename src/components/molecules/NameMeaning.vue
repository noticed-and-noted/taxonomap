<script setup lang="ts">
/** "What the name means": each word of a scientific name and its Wiktionary meaning. */
import { LICENCE_URLS } from '~/lib/gbif/licence';
import type { NamePart } from '~/lib/species/etymology';

defineProps<{ nameParts: NamePart[] | null }>();

/** A word's glosses, each in quotes: “wide, flat” + “snout, beak”. */
const quoted = (meanings: string[]) => meanings.map((meaning) => `“${meaning}”`).join(' + ');
</script>

<template>
  <section v-if="nameParts?.length" aria-labelledby="meaning-h">
    <h2 id="meaning-h" class="mb-2 font-display text-xl">What the name means</h2>
    <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
      <template v-for="part in nameParts" :key="part.word">
        <dt class="sci-name text-base">
          <a :href="part.url" rel="noopener">{{ part.word }}</a>
        </dt>
        <dd>
          {{ quoted(part.meanings) }}
          <span
            v-if="part.language"
            class="ml-1 inline-block rounded-sm border border-border px-1.5 text-xs whitespace-nowrap text-muted"
            >{{ part.language }}</span
          >
        </dd>
      </template>
    </dl>
    <p class="mt-2 text-xs text-subtle">
      From <a href="https://en.wiktionary.org" rel="noopener">Wiktionary</a>, under
      <a :href="LICENCE_URLS['CC-BY-SA']" rel="license noopener">CC BY-SA 4.0</a>.
    </p>
  </section>
</template>
