<script setup lang="ts">
/** The species being analysed: its photo and names, with Change to pick another. */
import { computed, ref, watch } from 'vue';
import SpeciesThumb from '~/components/molecules/SpeciesThumb.vue';
import { useLeadPhotos } from '~/composables/useLeadPhotos';
import { STARTING_SPECIES } from '~/lib/analyse/starting-species';
import { getSpecies } from '~/lib/gbif';
import { $analyseTaxon } from '~/stores/analyse';

const props = defineProps<{ speciesKey: number }>();

const fromList = computed(() => STARTING_SPECIES.find((species) => species.key === props.speciesKey));
/** Names for a species opened from search or a link: GBIF's name usage. */
const looked = ref<{ scientificName: string; commonName: string | undefined } | null>(null);

watch(
  () => props.speciesKey,
  async (key, _previous, onCleanup) => {
    looked.value = null;
    if (fromList.value) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    // A failed lookup leaves the "Species N" fallback: the analysis still works by key.
    const usage = await getSpecies(key, controller.signal).catch(() => undefined);
    if (usage)
      looked.value = { scientificName: usage.canonicalName ?? usage.scientificName, commonName: usage.vernacularName };
  },
  { immediate: true },
);

const { images, commonNames, isPending } = useLeadPhotos(() => [props.speciesKey]);

const scientificName = computed(
  () => fromList.value?.scientificName ?? looked.value?.scientificName ?? `Species ${props.speciesKey}`,
);
const commonName = computed(
  () => fromList.value?.commonName ?? commonNames.value.get(props.speciesKey) ?? looked.value?.commonName,
);
</script>

<template>
  <div class="flex items-center gap-3 rounded-md border border-border p-2">
    <SpeciesThumb
      :image="images.get(speciesKey)"
      :pending="isPending(speciesKey)"
      :name="commonName ?? scientificName"
      class="size-12"
    />
    <span class="min-w-0 flex-1">
      <span class="block truncate">{{ commonName ?? scientificName }}</span>
      <span v-if="commonName" class="sci-name block truncate text-[0.8125rem] text-muted">{{ scientificName }}</span>
    </span>
    <button
      type="button"
      aria-label="Change species"
      class="change-button h-8 rounded-sm border border-border px-2.5 text-[0.8125rem] hover:bg-surface-2"
      @click="$analyseTaxon.set(null)"
    >
      Change
    </button>
  </div>
</template>

<style scoped>
@media (pointer: coarse) {
  .change-button {
    height: 2.75rem;
  }
}
</style>
