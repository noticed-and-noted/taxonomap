<script setup lang="ts">
/**
 * What's near me (client:only). The persisted map switches to "pin" mode:
 * click to drop a pin, or use geolocation after an explainer. Location is
 * rounded to 3 dp before any use. Panel: sortable species table, the
 * circle's records (as in a map cell's Records tab), share card.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { full } from '~/lib/format';
import { RADIUS_STEPS_KM } from '~/lib/gbif';
import {
  classesNear,
  NEAR_SPECIES,
  nearFilter,
  speciesNear,
  speciesTallies,
  type Area,
  type ClassGroup,
  type SpeciesRow,
} from '~/lib/near/data';
import { nameFromRecords } from '~/lib/species/groups';
import { loadSpeciesManifest } from '~/lib/species/links';
import { $flyTo, $mapMode } from '~/stores/explorer';
import {
  $nearAt,
  $nearRadius,
  $nearTab,
  $nearThisMonth,
  exitNearMode,
  setNearLocation,
  zoomForRadius,
} from '~/stores/near';
import BasemapSwitcher from './BasemapSwitcher.vue';
import HexRecords from './HexRecords.vue';
import MapProgress from './MapProgress.vue';
import NearPlaceSearch from './NearPlaceSearch.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import ShareDialog from './ShareDialog.vue';
import SpeciesTable from './SpeciesTable.vue';
import { useLatestLoad } from './useLatestLoad';

const at = useStore($nearAt);
const radius = useStore($nearRadius);
const thisMonth = useStore($nearThisMonth);
const tab = useStore($nearTab);

const MONTH = new Date().getMonth() + 1;
const monthName = new Date().toLocaleString('en', { month: 'long' });

const panelOpen = ref(true);
const geoState = ref<'idle' | 'asking' | 'denied' | 'unavailable'>('idle');
const { loading, error, run: runArea, cancel: cancelArea } = useLatestLoad();
const total = ref(0);

const classes = shallowRef<ClassGroup[]>([]);
const species = shallowRef<SpeciesRow[]>([]);
/** Class the species list is narrowed to, or null for the whole area. */
const group = ref<number | null>(null);
const shareOpen = ref(false);
const tallies = shallowRef<Awaited<ReturnType<typeof speciesTallies>> | null>(null);

const area = computed<Area | null>(() =>
  at.value
    ? { lat: at.value.lat, lng: at.value.lng, radiusKm: radius.value, ...(thisMonth.value && { month: MONTH }) }
    : null,
);
const recordsFilter = computed(() => area.value && nearFilter(area.value));
const radiusIndex = computed(() => (RADIUS_STEPS_KM as readonly number[]).indexOf(radius.value));
const tableNote = computed(() =>
  species.value.length >= NEAR_SPECIES ? `the ${NEAR_SPECIES} most recorded` : undefined,
);

function onRadius(e: Event) {
  const i = Number((e.target as HTMLInputElement).value);
  $nearRadius.set(RADIUS_STEPS_KM[i] ?? 2);
}

function locate() {
  if (!('geolocation' in navigator)) {
    geoState.value = 'unavailable';
    return;
  }
  geoState.value = 'asking';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geoState.value = 'idle';
      // Rounded to 3 dp (~100 m) before it is used anywhere.
      setNearLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      geoState.value = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
}

/** Load the area's groups and species; a new pin or radius aborts the last area's requests. */
async function loadArea() {
  const a = area.value;
  classes.value = [];
  species.value = [];
  group.value = null;
  tallies.value = null;
  if (!a) {
    cancelArea();
    error.value = null;
    return;
  }
  $flyTo.set({ kind: 'point', lng: a.lng, lat: a.lat, zoom: zoomForRadius(a.radiusKm) });
  await runArea(async (signal) => {
    const [r, rows] = await Promise.all([classesNear(a, signal), speciesNear(a, null, signal)]);
    if (signal.aborted) return;
    total.value = r.records;
    classes.value = r.classes;
    await showSpecies(rows, signal);
  });
}

async function showSpecies(rows: SpeciesRow[], signal: AbortSignal) {
  species.value = rows;
  const named = await nameFromRecords(rows, signal);
  if (!signal.aborted) species.value = named;
}

/** Narrow the species list to one group (null for all); one request each time. */
async function pickGroup(key: number | null) {
  const a = area.value;
  if (!a || key === group.value) return;
  group.value = key;
  species.value = [];
  await runArea(async (signal) => {
    const rows = await speciesNear(a, key, signal);
    if (!signal.aborted) await showSpecies(rows, signal);
  });
}

async function openShare() {
  const a = area.value;
  if (!a) return;
  shareOpen.value = true;
  if (!tallies.value) tallies.value = await speciesTallies(a, classes.value).catch(() => null);
}

const setTab = (t: 'species' | 'recent') => $nearTab.set(t);
const toggleMonth = () => $nearThisMonth.set(!thisMonth.value);

watch(area, () => void loadArea(), { deep: true });

onMounted(() => {
  $mapMode.set('pin');
  void loadSpeciesManifest();
  void loadArea();
});

onBeforeUnmount(() => {
  $mapMode.set('explore');
});
</script>

<template>
  <div class="near-explorer pointer-events-none absolute inset-0 z-10">
    <!-- Centred in the top row of pills; below it on phones, where the taxon chip can fill the row. -->
    <MapProgress class="absolute left-1/2 top-12 -translate-x-1/2 sm:top-3" />
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
             short screen a list keeps its 12rem minimum and the panel scrolls instead. -->
        <section v-else class="flex h-full flex-col gap-4">
          <div class="space-y-3 text-sm">
            <NearPlaceSearch />
            <label class="block">
              <span class="flex justify-between text-xs text-muted">
                <span>Within</span><span class="font-medium text-text">{{ radius }} km</span>
              </span>
              <input
                type="range"
                min="0"
                :max="RADIUS_STEPS_KM.length - 1"
                step="1"
                :value="radiusIndex"
                class="mt-1 w-full accent-[var(--accent)]"
                :aria-valuetext="`${radius} kilometres`"
                @change="onRadius"
              />
              <span class="flex justify-between text-[10px] text-subtle" aria-hidden="true">
                <span v-for="r in RADIUS_STEPS_KM" :key="r">{{ r }}</span>
              </span>
            </label>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                class="chip"
                :class="{ on: thisMonth }"
                :aria-pressed="thisMonth"
                @click="toggleMonth"
              >
                Recorded in {{ monthName }}
              </button>
              <button type="button" class="chip" @click="locate">Use my location</button>
              <button type="button" class="chip ml-auto" :disabled="!classes.length" @click="openShare">Share</button>
            </div>
            <p class="text-xs text-subtle">Search a place or click the map to move the pin.</p>
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
              v-for="t in ['species', 'recent'] as const"
              :key="t"
              role="tab"
              type="button"
              :aria-selected="tab === t"
              class="-mb-px border-b-2 px-3 py-1.5"
              :class="tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
              @click="setTab(t)"
            >
              {{ t === 'species' ? 'Species' : 'Records' }}
            </button>
          </div>

          <!-- Species -->
          <div v-if="tab === 'species'" role="tabpanel" class="flex min-h-0 flex-1 flex-col">
            <div v-if="error" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
              GBIF is busy right now. <button type="button" class="underline" @click="loadArea">Try again</button>
            </div>
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
          <div v-else role="tabpanel" aria-label="Records">
            <HexRecords :species="species" :filter="recordsFilter" />
          </div>
        </section>
      </ResponsivePanel>
    </div>

    <div class="pointer-events-auto">
      <ShareDialog
        v-if="at"
        :open="shareOpen"
        :lat="at.lat"
        :lng="at.lng"
        :radius-km="radius"
        :month="thisMonth ? monthName : undefined"
        :groups="tallies?.groups ?? []"
        :total-species="tallies?.total ?? 0"
        :all-top-names="tallies?.topNames ?? []"
        @close="shareOpen = false"
      />
    </div>
  </div>
</template>

<style scoped>
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
</style>
