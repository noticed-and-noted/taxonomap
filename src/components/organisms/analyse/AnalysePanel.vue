<script setup lang="ts">
/** Analyse mode's panel: a side panel on desktop, a sheet on phones. The species picker and tabs fill it next. */
import { ref } from 'vue';
import ResponsivePanel from '~/components/molecules/ResponsivePanel.vue';
import { setMapMode } from '~/stores/mode';

const isOpen = ref(true);
</script>

<template>
  <div class="pointer-events-auto">
    <ResponsivePanel
      title="Analyse"
      :open="isOpen"
      collapsible
      tab-label="Analyse"
      dismissible="Leave Analyse"
      @close="isOpen = false"
      @open="isOpen = true"
      @dismiss="setMapMode('explore')"
    >
      <p class="text-sm text-muted">
        Pick a species, then show how its records move through the year (Migration) or how it has spread across years
        (Spread).
      </p>
    </ResponsivePanel>
  </div>
</template>
