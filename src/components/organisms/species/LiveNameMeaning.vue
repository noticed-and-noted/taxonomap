<script setup lang="ts">
/**
 * "What the name means" on a pre-rendered species page (client island). Looked up on
 * Wiktionary in the browser rather than baked, so the bake doesn't wait on thousands of
 * Wiktionary requests; the section shows once the meanings arrive.
 */
import { onMounted, shallowRef } from 'vue';
import NameMeaning from '~/components/molecules/NameMeaning.vue';
import { nameMeaning, type NamePart } from '~/lib/species/etymology';

const props = defineProps<{ canonicalName: string }>();

const nameParts = shallowRef<NamePart[] | null>(null);

onMounted(async () => {
  // The page reads fine without it, so a failed lookup just leaves it out.
  nameParts.value = await nameMeaning(props.canonicalName).catch(() => null);
});
</script>

<template>
  <NameMeaning :name-parts="nameParts" />
</template>
