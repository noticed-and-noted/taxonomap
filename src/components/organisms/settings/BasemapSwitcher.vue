<script setup lang="ts">
/** The basemap choice (Plain, Satellite) as a segmented toggle. */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import SegmentedControl from '~/components/atoms/SegmentedControl.vue';
import { BASEMAPS, BASEMAP_IDS, type BasemapId } from '~/lib/basemaps';
import { $basemap } from '~/stores/explorer';

const current = useStore($basemap);
const basemap = computed({ get: () => current.value, set: (id: BasemapId) => $basemap.set(id) });
const options = BASEMAP_IDS.map((id) => ({ value: id, label: BASEMAPS[id].label }));
</script>

<template>
  <SegmentedControl v-model="basemap" legend="Basemap" :options="options" class="basemap-switcher" />
</template>

<style scoped>
/* Small text; tall enough to tap in the phone's settings sheet, 2rem beside the mode switch from 640px. */
.basemap-switcher {
  box-shadow: var(--shadow);
  font-size: 0.75rem;
}
.basemap-switcher :deep(label) {
  display: flex;
  align-items: center;
  padding-block: 0.5rem;
}
@media (min-width: 640px) {
  .basemap-switcher {
    height: 2rem;
  }
  .basemap-switcher :deep(label) {
    padding-block: 0;
  }
}
</style>
