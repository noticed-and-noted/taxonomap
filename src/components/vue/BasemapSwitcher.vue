<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { useId } from 'vue';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from '~/lib/basemaps';
import { $basemap } from '~/stores/explorer';

const current = useStore($basemap);
// Unique per instance: the overlay renders a desktop and a mobile copy.
const group = `basemap-${useId()}`;
const choose = (id: BasemapId) => $basemap.set(id);
</script>

<template>
  <fieldset class="basemap-switcher flex rounded-md border border-border bg-surface p-0.5 shadow-panel">
    <legend class="sr-only">Basemap</legend>
    <label
      v-for="id in BASEMAP_IDS"
      :key="id"
      class="cursor-pointer rounded-sm px-2.5 py-1 text-xs text-muted transition-colors duration-200 has-[:checked]:bg-accent has-[:checked]:text-accent-contrast has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] hover:text-text"
    >
      <input type="radio" :name="group" class="sr-only" :value="id" :checked="current === id" @change="choose(id)" />
      {{ BASEMAPS[id].label }}
    </label>
  </fieldset>
</template>
