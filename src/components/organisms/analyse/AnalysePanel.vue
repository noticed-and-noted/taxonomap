<script setup lang="ts">
/** Analyse mode's panel: a side panel on desktop, a sheet on phones. The species picker and tabs fill it next. */
import { useStore } from '@nanostores/vue';
import ResponsivePanel from '~/components/molecules/ResponsivePanel.vue';
import { $analysePanelOpen } from '~/stores/mode';

const isOpen = useStore($analysePanelOpen);
const openPanel = () => $analysePanelOpen.set(true);
const closePanel = () => $analysePanelOpen.set(false);
</script>

<template>
  <div class="pointer-events-auto">
    <ResponsivePanel
      title="Analyse"
      :open="isOpen"
      collapsible
      tab-label="Analyse"
      @close="closePanel"
      @open="openPanel"
    >
      <p class="text-sm text-muted">
        Pick a species, then show how its records move through the year (Migration) or how it has spread across years
        (Spread).
      </p>
    </ResponsivePanel>
  </div>
</template>
