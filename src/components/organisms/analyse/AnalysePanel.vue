<script setup lang="ts">
/**
 * Analyse mode's panel: a side panel on desktop, a sheet on phones. With no species it shows the picker; with one,
 * the species, the years included and the Migration and Spread tabs.
 */
import { useStore } from '@nanostores/vue';
import ResponsivePanel from '~/components/molecules/ResponsivePanel.vue';
import { $analyseTaxon, $analyseView, ANALYSE_VIEWS } from '~/stores/analyse';
import { $analysePanelOpen } from '~/stores/mode';
import AnalyseSpeciesCard from './AnalyseSpeciesCard.vue';
import AnalyseSpeciesTable from './AnalyseSpeciesTable.vue';
import AnalyseYears from './AnalyseYears.vue';

const VIEW_LABELS = { migration: 'Migration', spread: 'Spread' } as const;

const isOpen = useStore($analysePanelOpen);
const taxon = useStore($analyseTaxon);
const view = useStore($analyseView);

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
      <AnalyseSpeciesTable v-if="taxon === null" />

      <div v-else class="flex flex-col gap-4">
        <AnalyseSpeciesCard :species-key="taxon" />
        <AnalyseYears />

        <div role="tablist" aria-label="Analysis" class="flex gap-1 border-b border-border text-sm">
          <button
            v-for="viewName in ANALYSE_VIEWS"
            :key="viewName"
            role="tab"
            type="button"
            :aria-selected="view === viewName"
            class="-mb-px border-b-2 px-3 py-1.5"
            :class="view === viewName ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
            @click="$analyseView.set(viewName)"
          >
            {{ VIEW_LABELS[viewName] }}
          </button>
        </div>

        <div role="tabpanel" :aria-label="VIEW_LABELS[view]" class="text-sm text-muted">
          <p v-if="view === 'migration'">
            Where it was recorded in each month, with all the years above added together.
          </p>
          <p v-else>Where it was recorded for the first time, cell by cell, as the years go by.</p>
        </div>
      </div>
    </ResponsivePanel>
  </div>
</template>
