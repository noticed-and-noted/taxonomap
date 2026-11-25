<script setup lang="ts">
/**
 * The How filter's recorders: find someone's records (your own iNaturalist
 * observations, say) by the name GBIF holds them under. GBIF matches names
 * exactly, so names are picked from what it has, never typed in free.
 */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import SuggestPicker, { type Suggestion } from '~/components/molecules/SuggestPicker.vue';
import { findRecorders } from '~/lib/gbif';
import { $occurrenceFilter } from '~/stores/filters';
import { $recorders, addRecorder, MAX_RECORDERS, removeRecorder } from '~/stores/recorder';

const names = useStore($recorders);
const selected = computed(() => names.value.map((name) => ({ key: name, name })));

/** Recorder names matching the text, counted under every filter but this one. */
async function searchRecorders(text: string, signal: AbortSignal): Promise<Suggestion[]> {
  // Leave out the recorder filter itself, or only the picked recorders would match.
  const otherFilters = { ...$occurrenceFilter.get(), recorders: undefined };
  const hits = await findRecorders(text, otherFilters, signal);
  return hits.map((hit) => ({ key: hit.name, title: hit.name, count: hit.count }));
}
</script>

<template>
  <SuggestPicker
    label="Recorded by"
    plural="recorders"
    :selected="selected"
    :max="MAX_RECORDERS"
    :search="searchRecorders"
    hint="Names as the records give them, such as an iNaturalist display name. iNaturalist shares only research-grade records with GBIF."
    @pick="(suggestion) => addRecorder(suggestion.key)"
    @remove="removeRecorder"
    @clear="$recorders.set([])"
  />
</template>
