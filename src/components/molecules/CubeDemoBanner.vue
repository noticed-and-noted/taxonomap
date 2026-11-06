<script setup lang="ts">
/**
 * The cube demo note for pages without a map (tree of life, species pages): what the counts were baked
 * from, so a sample's estimates are never mistaken for GBIF's numbers. Shown only in cube mode.
 */
import { useStore } from '@nanostores/vue';
import { computed, onMounted } from 'vue';
import { $cubesOn, $openCubes, openedCubes } from '~/stores/cubes';

const cubesOn = useStore($cubesOn);
const cubes = useStore($openCubes);

/** "a 0.97% sample of GBIF's 2026-11-01 snapshot", or the whole snapshot for a full bake. */
const source = computed(() => {
  const opened = cubes.value;
  if (!opened) return 'a sample of GBIF’s snapshot';
  if (opened.partsRead >= opened.partsTotal) return `GBIF’s ${opened.snapshot} snapshot`;
  const percent = Number(((opened.partsRead / opened.partsTotal) * 100).toPrecision(2));
  return `a ${percent}% sample of GBIF’s ${opened.snapshot} snapshot`;
});

// Not knowing the snapshot just leaves the note general.
onMounted(() => cubesOn.value && openedCubes().catch(() => undefined));
</script>

<template>
  <p v-if="cubesOn" role="status" class="cube-demo-banner">
    <strong class="font-medium text-text">Cube demo:</strong> counts come from {{ source }}, so they're estimates.
  </p>
</template>

<style scoped>
.cube-demo-banner {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>
