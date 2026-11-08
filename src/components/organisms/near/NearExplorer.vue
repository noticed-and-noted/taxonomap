<script setup lang="ts">
/**
 * What's near me (client:only). The persisted map switches to "pin" mode:
 * click to drop a pin, or use geolocation after an explainer. Location is
 * rounded to 3 dp before any use. Panel: sortable species table, the
 * circle's records (as in a map cell's Records tab).
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import BasemapSwitcher from '~/components/molecules/BasemapSwitcher.vue';
import InlineAlert from '~/components/molecules/InlineAlert.vue';
import ResponsivePanel from '~/components/molecules/ResponsivePanel.vue';
import HexRecords from '~/components/organisms/cell/HexRecords.vue';
import SpeciesTable from '~/components/organisms/cell/SpeciesTable.vue';
import MapProgress from '~/components/organisms/map/MapProgress.vue';
import { useLatestLoad } from '~/composables/useLatestLoad';
import { full } from '~/lib/format';
import { RADIUS_STEPS_KM } from '~/lib/gbif';
import { circleRing } from '~/lib/gbif/params';
import { boundsOf } from '~/lib/map/recordFit';
import {
  classesNear,
  NEAR_SPECIES,
  nearFilter,
  speciesNear,
  type Area,
  type ClassGroup,
  type SpeciesRow,
} from '~/lib/near/data';
import { loadSpeciesManifest } from '~/lib/species/links';
import { $flyTo, $mapMode, $occurrenceFilter } from '~/stores/explorer';
import {
  $nearAt,
  $nearLeaving,
  $nearRadius,
  $nearTab,
  $nearThisMonth,
  DEFAULT_RADIUS_KM,
  exitNearMode,
  setNearLocation,
  zoomForRadius,
} from '~/stores/near';
import NearPlaceSearch from './NearPlaceSearch.vue';

const at = useStore($nearAt);
const radius = useStore($nearRadius);
const thisMonth = useStore($nearThisMonth);
const tab = useStore($nearTab);
const filter = useStore($occurrenceFilter);

const MONTH = new Date().getMonth() + 1;
const monthName = new Date().toLocaleString('en', { month: 'long' });

const panelOpen = ref(true);
const startLeaving = () => $nearLeaving.set(true);
const geoState = ref<'idle' | 'asking' | 'denied' | 'unavailable'>('idle');
const { loading, error, run: runArea, cancel: cancelArea } = useLatestLoad();
const total = ref(0);

const classes = shallowRef<ClassGroup[]>([]);
const species = shallowRef<SpeciesRow[]>([]);
/** Class the species list is narrowed to, or null for the whole area. */
const group = ref<number | null>(null);

const area = computed<Area | null>(() =>
  at.value
    ? {
        lat: at.value.lat,
        lng: at.value.lng,
        radiusKm: radius.value,
        filter: filter.value,
        ...(thisMonth.value && { month: MONTH }),
      }
    : null,
);
const recordsFilter = computed(() => area.value && nearFilter(area.value));
const radiusIndex = computed(() => (RADIUS_STEPS_KM as readonly number[]).indexOf(radius.value));
const LAST_RADIUS_STEP = RADIUS_STEPS_KM.length - 1;
const tableNote = computed(() =>
  species.value.length >= NEAR_SPECIES ? `the ${NEAR_SPECIES} most recorded` : undefined,
);

/** The step under the thumb while it is being dragged, before the radius is committed on release. */
const draggedStep = ref<number | null>(null);
const shownStep = computed(() => draggedStep.value ?? radiusIndex.value);

function stepOf(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function onRadiusDrag(event: Event) {
  draggedStep.value = stepOf(event);
}

function onRadius(event: Event) {
  draggedStep.value = null;
  $nearRadius.set(RADIUS_STEPS_KM[stepOf(event)] ?? DEFAULT_RADIUS_KM);
}

function locate() {
  if (!('geolocation' in navigator)) {
    geoState.value = 'unavailable';
    return;
  }
  geoState.value = 'asking';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      geoState.value = 'idle';
      // Rounded to 3 dp (~100 m) before it is used anywhere.
      setNearLocation(position.coords.latitude, position.coords.longitude);
    },
    (positionError) => {
      geoState.value = positionError.code === positionError.PERMISSION_DENIED ? 'denied' : 'unavailable';
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
}

/** Load the area's groups and species; a new pin or radius aborts the last area's requests. */
async function loadArea() {
  const searchArea = area.value;
  classes.value = [];
  species.value = [];
  group.value = null;
  if (!searchArea) {
    cancelArea();
    error.value = null;
    return;
  }
  await runArea(async (signal) => {
    const [summary, rows] = await Promise.all([classesNear(searchArea, signal), speciesNear(searchArea, null, signal)]);
    if (signal.aborted) return;
    total.value = summary.records;
    classes.value = summary.classes;
    species.value = rows;
  });
}

/** Narrow the species list to one group (null for all); one request each time. */
async function pickGroup(key: number | null) {
  const searchArea = area.value;
  if (!searchArea || key === group.value) return;
  group.value = key;
  species.value = [];
  await runArea(async (signal) => {
    const rows = await speciesNear(searchArea, key, signal);
    if (!signal.aborted) species.value = rows;
  });
}

const setTab = (nextTab: 'species' | 'recent') => $nearTab.set(nextTab);

/** Frame the pin and radius, zooming out if the panels leave too little room; filter changes leave the view where it is. */
function flyToArea() {
  if (!at.value) return;
  const { lat, lng } = at.value;
  $flyTo.set({
    kind: 'bounds',
    bbox: boundsOf(circleRing(lat, lng, radius.value)),
    maxZoom: zoomForRadius(radius.value),
    centre: [lng, lat],
  });
}

watch(area, () => void loadArea(), { deep: true });
watch([at, radius], flyToArea);

onMounted(() => {
  $mapMode.set('pin');
  void loadSpeciesManifest();
  flyToArea();
  void loadArea();
});

onBeforeUnmount(() => {
  $mapMode.set('explore');
});
</script>

<template>
  <div class="near-explorer pointer-events-none absolute inset-0 z-10">
    <!-- Below the top row of pills, so a note never runs under the basemap switch; over the map, not the panel. -->
    <MapProgress class="absolute left-1/2 top-12 -translate-x-1/2" :class="{ 'beside-panel': panelOpen }" />
    <button
      v-if="!panelOpen"
      type="button"
      class="pointer-events-auto absolute left-3 top-3 rounded-full md:hidden border border-border bg-surface px-4 py-2 text-sm shadow-panel"
      @click="panelOpen = true"
    >
      Show list
    </button>

    <!-- Basemap stays in near me; it slides with the panel when it's tucked away. -->
    <div
      class="near-bar pointer-events-none absolute right-3 top-3 *:pointer-events-auto"
      :class="{ tucked: !panelOpen }"
    >
      <div class="hidden sm:block"><BasemapSwitcher /></div>
    </div>

    <div class="pointer-events-auto">
      <ResponsivePanel
        title="What’s near me"
        :open="panelOpen"
        collapsible
        dismissible="Leave near me"
        @close="panelOpen = false"
        @open="panelOpen = true"
        @closing="startLeaving"
        @dismiss="exitNearMode"
      >
        <!-- No location yet: explainer -->
        <section v-if="!at" class="space-y-4 text-sm">
          <p>See which species have been recorded around a place, ranked by how often they’ve been seen.</p>
          <NearPlaceSearch />
          <div class="rounded-md border border-border bg-surface-2 p-3 text-xs text-muted">
            <p class="font-medium text-text">About your location</p>
            <p class="mt-1">
              If you use your location, it’s read once, rounded to about 100 m, and only sent to GBIF as a search area.
              It appears in the page address so you can share the view. Nothing else is stored or tracked.
            </p>
          </div>
          <button
            type="button"
            class="w-full rounded-md bg-accent px-4 py-2 font-medium text-accent-contrast"
            :disabled="geoState === 'asking'"
            @click="locate"
          >
            {{ geoState === 'asking' ? 'Finding you…' : 'Use my location' }}
          </button>
          <p class="text-center text-muted">or click anywhere on the map to drop a pin</p>
          <p v-if="geoState === 'denied'" class="text-xs text-muted" role="status">
            Location permission was declined. You can drop a pin on the map instead.
          </p>
          <p v-if="geoState === 'unavailable'" class="text-xs text-muted" role="status">
            Your location isn’t available right now. Drop a pin on the map instead.
          </p>
        </section>

        <!-- Location set -->
        <!-- Exactly the panel's height, so the active list can fill what's left. On a very
             short screen a list keeps its 12rem minimum and the panel scrolls instead. On phones the
             half-height sheet would leave the list a sliver, so it gets most of the screen and the sheet scrolls to it. -->
        <section v-else class="flex flex-col gap-4 sm:h-full">
          <div class="space-y-3 text-sm">
            <NearPlaceSearch />
            <label class="block">
              <span class="flex justify-between text-xs text-muted">
                <span>Within</span><span class="font-medium text-text">{{ radius }} km</span>
              </span>
              <input
                type="range"
                min="0"
                :max="LAST_RADIUS_STEP"
                step="1"
                :value="radiusIndex"
                class="radius-slider w-full"
                :style="{ '--progress': Math.max(shownStep, 0) / LAST_RADIUS_STEP }"
                :aria-valuetext="`${radius} kilometres`"
                @input="onRadiusDrag"
                @change="onRadius"
              />
              <span class="radius-stops text-[0.625rem] text-subtle" aria-hidden="true">
                <span
                  v-for="(radiusKm, step) in RADIUS_STEPS_KM"
                  :key="radiusKm"
                  :style="{ '--stop': step / LAST_RADIUS_STEP }"
                  >{{ radiusKm }}</span
                >
              </span>
            </label>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" class="chip" @click="locate">Use my location</button>
              <span class="text-subtle">Search a place or click the map to move the pin.</span>
            </div>
          </div>

          <p v-if="!loading && !error" class="text-sm text-muted" aria-live="polite">
            <span class="font-medium text-text">{{ full(total) }}</span> records within {{ radius }} km<span
              v-if="thisMonth"
            >
              in {{ monthName }}</span
            >.
          </p>

          <div role="tablist" aria-label="Lists" class="flex gap-1 border-b border-border text-sm">
            <button
              v-for="tabName in ['species', 'recent'] as const"
              :key="tabName"
              role="tab"
              type="button"
              :aria-selected="tab === tabName"
              class="-mb-px border-b-2 px-3 py-1.5"
              :class="tab === tabName ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
              @click="setTab(tabName)"
            >
              {{ tabName === 'species' ? 'Species' : 'Records' }}
            </button>
          </div>

          <!-- Species -->
          <div v-if="tab === 'species'" role="tabpanel" class="list-panel flex min-h-0 flex-1 flex-col">
            <InlineAlert v-if="error" :kind="error" @retry="loadArea">
              {{ error === 'unavailable' ? 'GBIF is busy right now.' : 'Species near here could not be loaded.' }}
            </InlineAlert>
            <p v-else-if="!loading && !species.length" class="rounded-md bg-surface-2 p-3 text-sm text-muted">
              No records here yet{{ thisMonth ? ` for ${monthName}` : '' }}. Try a larger radius{{
                thisMonth ? ' or all months' : ''
              }}.
            </p>
            <SpeciesTable
              v-else
              :rows="species"
              :groups="classes"
              :loading="loading"
              :note="tableNote"
              :group="group"
              fill
              @update:group="pickGroup"
            />
          </div>

          <!-- Records: the same list as a map cell's Records tab -->
          <div v-else role="tabpanel" aria-label="Records" class="list-panel flex min-h-0 flex-1 flex-col">
            <HexRecords :species="species" :filter="recordsFilter" fill />
          </div>
        </section>
      </ResponsivePanel>
    </div>
  </div>
</template>

<style scoped>
/* About the full-height sheet's body, less the tabs. */
@media (max-width: 639px) {
  .list-panel {
    flex: none;
    height: 75dvh;
  }
}
/* Desktop: beside the panel, which is always on screen (open, or tucked to a strip). */
@media (min-width: 768px) {
  .near-bar {
    right: calc(var(--panel-width) + 1.5rem);
    transition: transform var(--dur-slow) var(--ease);
  }
  /* The same distance SidePanel's .collapsed moves the panel, so they slide together. */
  .near-bar.tucked {
    transform: translateX(calc(var(--panel-width) + 0.75rem - 4rem));
  }
  /* Centred on the map left of the open panel, and narrow enough to clear the rail and the panel. */
  .beside-panel {
    left: calc((100% - var(--panel-width) - 0.75rem) / 2);
    --map-status-max-width: calc(100% - var(--panel-width) - 8rem);
  }
}

.chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  color: var(--text-muted);
}
.chip:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.chip.on {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.chip:disabled {
  opacity: 0.5;
}

/* A fixed thumb size, so the stop labels can sit under the thumb's centre at each step. */
.radius-slider,
.radius-stops {
  --thumb-size: 1.25rem;
}

.radius-slider {
  /* The thumb's centre travels between half a thumb in from each end, so the fill follows it there. */
  --filled: calc(var(--thumb-size) / 2 + (100% - var(--thumb-size)) * var(--progress));

  display: block;
  height: 1.75rem;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}

.radius-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--accent) var(--filled), var(--border-strong) var(--filled));
}

.radius-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--accent) var(--filled), var(--border-strong) var(--filled));
}

.radius-slider::-webkit-slider-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  margin-top: calc(2px - var(--thumb-size) / 2);
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  appearance: none;
}

.radius-slider::-moz-range-thumb {
  width: var(--thumb-size);
  height: var(--thumb-size);
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--accent);
  box-sizing: border-box;
}

.radius-slider:focus-visible {
  outline: none;
}

.radius-slider:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.radius-slider:focus-visible::-moz-range-thumb {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.radius-stops {
  position: relative;
  display: block;
  height: 1lh;
}

.radius-stops > span {
  position: absolute;
  left: calc(var(--thumb-size) / 2 + (100% - var(--thumb-size)) * var(--stop));
  translate: -50%;
}

@media (max-width: 639px) {
  .radius-slider {
    height: 2.75rem;
  }
}
</style>
