<script setup lang="ts">
/**
 * The How filter's publishers: GBIF's publishing organisations, searched by name
 * (the biggest by records are listed before anything is typed). Publishers with no
 * records under the other filters aren't offered.
 */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import SuggestPicker from '~/components/molecules/SuggestPicker.vue';
import { findPublishers } from '~/lib/gbif';
import { $occurrenceFilter } from '~/stores/explorer';
import {
  $publisherKeys,
  $publisherNames,
  addPublisher,
  MAX_PUBLISHERS,
  removePublisher,
  UNKNOWN_PUBLISHER,
} from '~/stores/publisher';

const keys = useStore($publisherKeys);
const names = useStore($publisherNames);
const selected = computed(() => keys.value.map((key) => ({ key, name: names.value[key] ?? UNKNOWN_PUBLISHER })));

/** Publishers matching the text, counted under every filter but this one. */
function searchPublishers(text: string, signal: AbortSignal) {
  // Leave out the publisher filter itself, or only the picked publishers would match.
  const otherFilters = { ...$occurrenceFilter.get(), publishers: undefined };
  return findPublishers(text, otherFilters, signal);
}
</script>

<template>
  <SuggestPicker
    label="Publisher"
    plural="publishers"
    :selected="selected"
    :max="MAX_PUBLISHERS"
    :search="searchPublishers"
    hint="Shows records from any selected publisher. Counts follow your other filters."
    @pick="addPublisher"
    @remove="removePublisher"
    @clear="$publisherKeys.set([])"
  />
</template>
