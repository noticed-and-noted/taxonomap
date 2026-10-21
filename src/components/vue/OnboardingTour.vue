<script setup lang="ts">
/**
 * First-visit guided tour of the map page: a welcome card, then five steps
 * that spotlight one or two parts of it (see Spotlight.vue). It picks the
 * busiest hex itself so the cell panel step has something to show, and clears
 * that selection when it ends. Finishing or skipping hands over to the "Try
 * this" checklist. The tour is modal, so the map holds still under it.
 */
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import type { ScreenBox } from '~/lib/tour';
import {
  $busiestHexBox,
  $busiestHexRequest,
  $mapLoad,
  $panel,
  $selectedHex,
  clearHexSelection,
} from '~/stores/explorer';
import { $tourOpen, finishTour } from '~/stores/onboarding';
import Spotlight from './Spotlight.vue';
import { boxOf, PANEL_SELECTOR, speciesListBox } from './tourTargets';

interface TourStep {
  title: string;
  body: string;
  /** What to spotlight; the first box anchors the tip. A step with none is skipped. */
  targets: () => (ScreenBox | null)[];
  enter?: () => void;
}

const WELCOME = -1;

let didSelectHex = false;
let stopWaitingForCells = () => {};
/** Which way the last move went, so a step with nothing to show is skipped the same way. */
let direction = 1;

/** Ask the map for its busiest hex; true once one is selected. */
function requestHex(): boolean {
  $busiestHexBox.set(null);
  $busiestHexRequest.set('select');
  didSelectHex = $busiestHexBox.get() !== null;
  return didSelectHex;
}

/** Select the busiest hex once (after the cells load, if they haven't); coming back keeps it, panel closed. */
function pickHex() {
  if ($panel.get() === 'hex') $panel.set('none');
  if (didSelectHex || requestHex()) return;
  stopWaitingForCells();
  stopWaitingForCells = $mapLoad.listen((load) => {
    if (load.loading || stepIndex.value !== 0) return;
    stopWaitingForCells();
    // The layer stores new cells on its next frame's draw, queued before this one.
    requestAnimationFrame(requestHex);
  });
}

const STEPS: TourStep[] = [
  {
    title: 'Every hex is a count',
    body: 'Each hex counts the records found inside it. Darker hexes hold more, and the legend shows how many, on a log scale.',
    enter: pickHex,
    targets: () => [$busiestHexBox.get(), boxOf('[data-tour="legend"]')],
  },
  {
    title: 'Inside a hex',
    body: 'Clicking a hex opens this panel: its record count, the species found there, single records, and the months they turn up.',
    enter: () => $selectedHex.get() && $panel.set('hex'),
    targets: () => [$selectedHex.get() ? boxOf(PANEL_SELECTOR) : null, $busiestHexBox.get()],
  },
  {
    title: 'Search',
    body: 'Find a species, a group such as birds, or a place. Picking a species shows only its records.',
    targets: () => [boxOf('[data-tour="search"]')],
  },
  {
    title: 'Filters',
    body: 'Narrow the map by what was found, when and where, and how it was recorded.',
    targets: () => [boxOf('[data-tour="filters"]')],
  },
  {
    title: 'Beyond the map',
    body: 'Tree of life browses every group by its records. Open any species in the list for its photos and seasons.',
    targets: () => [boxOf('[data-tour="nav"]'), speciesListBox()],
  },
];

const titleId = useId();
const spotlight = ref<InstanceType<typeof Spotlight>>();
const stepIndex = ref(WELCOME);

const step = computed(() => STEPS[stepIndex.value]);
const isLast = computed(() => stepIndex.value === STEPS.length - 1);
const currentTargets = () => step.value?.targets() ?? [];

function end() {
  $busiestHexBox.set(null);
  if (didSelectHex) clearHexSelection();
  finishTour();
}

function go(index: number) {
  direction = index > stepIndex.value ? 1 : -1;
  if (index >= STEPS.length) return end();
  STEPS[index]?.enter?.();
  stepIndex.value = index;
}

function onSettled(count: number) {
  if (step.value && !count) go(stepIndex.value + direction);
}

// The map moves the hex's box when it resizes.
const stopFollowingHex = $busiestHexBox.listen(() => spotlight.value?.measure());

onMounted(() => $tourOpen.set(true));

onBeforeUnmount(() => {
  stopWaitingForCells();
  stopFollowingHex();
  $tourOpen.set(false);
});
</script>

<template>
  <Spotlight
    ref="spotlight"
    :targets="currentTargets"
    :step-key="stepIndex"
    :labelledby="titleId"
    @settled="onSettled"
    @close="end"
  >
    <template v-if="!step">
      <h2 :id="titleId" class="font-display text-xl">Welcome to taxonomap</h2>
      <p class="mt-2 text-sm text-muted">
        The map is built on GBIF, the Global Biodiversity Information Facility: billions of records pooled from museums,
        herbaria, research surveys and nature apps like iNaturalist.
      </p>
      <p class="mt-2 text-sm text-muted">
        A record is one find of one organism: what it was, where, and when. It might be a museum specimen, a photo, or a
        sighting in a survey. Each hex counts the records found inside it.
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="tour-btn" @click="end">Skip</button>
        <button type="button" class="tour-btn primary" @click="go(0)">Start tour</button>
      </div>
    </template>
    <template v-else>
      <h2 :id="titleId" class="font-display text-lg">{{ step.title }}</h2>
      <p class="mt-1 text-sm text-muted">{{ step.body }}</p>
      <div class="mt-3 flex items-center gap-2">
        <span class="mr-auto text-xs text-subtle tabular-nums">{{ stepIndex + 1 }} of {{ STEPS.length }}</span>
        <button v-if="!isLast" type="button" class="tour-btn quiet" @click="end">Skip</button>
        <button type="button" class="tour-btn" @click="go(stepIndex - 1)">Back</button>
        <button type="button" class="tour-btn primary" @click="go(stepIndex + 1)">
          {{ isLast ? 'Done' : 'Next' }}
        </button>
      </div>
    </template>
  </Spotlight>
</template>
