<script setup lang="ts">
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { zoomDrop } from '~/lib/map/occGrid';
import { nearestRecords, type NearestRecords } from '~/lib/map/taxonView';
import { binLabels, rampColors } from '~/lib/ramp';
import {
  $flyTo,
  $gridLevel,
  $groupCounts,
  $mapLoad,
  $mapView,
  $occurrenceFilter,
  $panel,
  $railOpen,
  $viewCheck,
  DEFAULT_VIEW,
} from '~/stores/explorer';
import { $ramp } from '~/stores/ramp';
import { $activeFilterCount, FILTER_GROUPS, PHONE_QUERY } from './filterGroups';
import SkeletonBlock from './SkeletonBlock.vue';
import { useLatestLoad } from './useLatestLoad';

/** Below this the grid is too coarse (cells ~400 km) to say more than "nearby". */
const NEARBY_KM = 100;

const level = useStore($gridLevel);
const viewCheck = useStore($viewCheck);
const isEmpty = computed(() => viewCheck.value.isEmpty);
const view = useStore($mapView);
const filter = useStore($occurrenceFilter);
const colors = ref<string[]>(rampColors());
// Bins follow the hex grid level (cells cover more ground when zoomed out).
const labels = computed(() => binLabels(level.value));

/** The nearest records once looked up; null when nothing matches anywhere. */
const nearest = ref<NearestRecords | null>();
const { loading, error, run } = useLatestLoad();

watch(
  [isEmpty, view, filter],
  () => {
    // Keep the last answer while a pan looks again, so the button doesn't flicker.
    if (!isEmpty.value) {
      nearest.value = undefined;
      return;
    }
    const centre: [number, number] = [view.value.lng, view.value.lat];
    void run(async (signal) => {
      const found = await nearestRecords(filter.value, centre);
      if (!signal.aborted) nearest.value = found;
    });
  },
  { immediate: true },
);

const mapLoad = useStore($mapLoad);
const filterCount = useStore($activeFilterCount);

/**
 * A filter came off an empty map, so records may be on their way. Only then does the
 * notice show it's loading: panning an empty map or adding a filter keeps it steady.
 */
const isLoosening = ref(false);
watch(filterCount, (count, previous) => {
  // Every tile was cached: nothing to wait for.
  if (isEmpty.value && count < previous && mapLoad.value.loading) isLoosening.value = true;
});
// Ends on the map's first check after the tiles are in, so the old notice never flashes back.
watch(viewCheck, () => {
  if (!mapLoad.value.loading) isLoosening.value = false;
});
const isChecking = computed(() => isEmpty.value && isLoosening.value);

const isEmptyAnywhere = computed(() => isEmpty.value && nearest.value === null);

/** The notice's button, if any: nothing while checking or before the nearest records are known. */
const action = computed(() => {
  if (isChecking.value || !isEmpty.value) return null;
  if (nearest.value) return 'fly';
  return isEmptyAnywhere.value ? 'edit' : null;
});

/** "under 100 km" or "about 5,700 km": the world grid is too coarse for more. */
const nearestDistance = computed(() => {
  const distanceKm = nearest.value?.distanceKm ?? 0;
  if (distanceKm < NEARBY_KM) return `under ${NEARBY_KM} km`;
  return `about ${(Math.round(distanceKm / 100) * 100).toLocaleString('en')} km`;
});

const ariaLabel = computed(() =>
  isEmpty.value
    ? 'No records per hexagon in this view'
    : `Records per hexagon, on a logarithmic scale from ${labels.value[0]} to over ${labels.value[labels.value.length - 1]} at this zoom`,
);

/** Turn the globe to the nearest records, zoomed out to the whole globe so they're seen in context. */
function flyToNearest() {
  if (!nearest.value) return;
  const [west, south, east, north] = nearest.value.extent;
  const lat = (south + north) / 2;
  // Compare globe sizes, not zooms: MapLibre lowers the zoom away from the equator to keep the globe's size.
  const globeSize = Math.min(
    view.value.zoom + zoomDrop(view.value.lat),
    DEFAULT_VIEW.zoom + zoomDrop(DEFAULT_VIEW.lat),
  );
  $flyTo.set({ kind: 'point', lng: (west + east) / 2, lat, zoom: globeSize - zoomDrop(lat) });
}

/** Open the filters where this screen keeps them, at the first group with something set. */
function editFilters() {
  if (window.matchMedia(PHONE_QUERY).matches) {
    $panel.set('filters');
    return;
  }
  const counts = $groupCounts.get();
  $railOpen.set(FILTER_GROUPS.find((group) => counts[group.id])?.id ?? 'what');
}

let observer: MutationObserver | undefined;
let unlisten: (() => void) | undefined;
onMounted(() => {
  observer = new MutationObserver(() => (colors.value = rampColors()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  unlisten = $ramp.listen(() => (colors.value = rampColors()));
});
onBeforeUnmount(() => {
  observer?.disconnect();
  unlisten?.();
});
</script>

<template>
  <div class="map-legend" data-testid="map-legend">
    <div role="img" :aria-label="ariaLabel">
      <p class="mb-1 text-xs font-medium text-muted">Records per cell</p>
      <SkeletonBlock v-if="isChecking" height="0.625rem" rounded="sm" />
      <div v-else class="flex h-2.5 overflow-hidden rounded-sm">
        <span
          v-for="colour in colors"
          :key="colour"
          class="swatch flex-1"
          :style="{ background: isEmpty ? 'var(--border)' : colour }"
        ></span>
      </div>
      <!-- Every other bin boundary, so labels never collide at narrow widths. -->
      <Transition name="fold">
        <div v-if="!isEmpty" class="fold" aria-hidden="true">
          <div>
            <div class="relative mt-0.5 h-3.5 text-xs text-subtle tabular-nums">
              <span
                v-for="(label, index) in labels"
                v-show="index % 2 === 0"
                :key="index"
                class="absolute top-0"
                :style="{ left: `${(index / labels.length) * 100}%` }"
                >{{ label }}</span
              >
            </div>
          </div>
        </div>
      </Transition>
    </div>
    <!-- Always rendered, so screen readers hear the notice when it fills in. -->
    <div aria-live="polite">
      <!-- A leaving fold keeps its last content, so the text holds still while it closes. -->
      <Transition name="fold">
        <div v-if="isEmpty" class="fold">
          <div>
            <p v-if="isChecking" class="mt-2 text-sm">Looking for records…</p>
            <template v-else>
              <p class="mt-2 text-sm tabular-nums">
                {{ isEmptyAnywhere ? '0 records anywhere' : '0 records in view' }}
              </p>
              <p v-if="isEmptyAnywhere" class="mt-0.5 text-xs text-subtle">No records match these filters.</p>
              <p v-else-if="nearest" class="mt-0.5 text-xs text-subtle">
                Closest are {{ nearestDistance }} <span class="whitespace-nowrap">{{ nearest.direction }}</span
                >.
              </p>
              <p v-else-if="error && !loading" class="mt-0.5 text-xs text-subtle">Try zooming out.</p>
            </template>
          </div>
        </div>
      </Transition>
    </div>
    <Transition name="fold">
      <div v-if="action" class="fold">
        <div>
          <button v-if="action === 'fly'" type="button" class="legend-action" @click="flyToNearest">
            Fly to nearest
          </button>
          <button v-else type="button" class="legend-action" @click="editFilters">Edit filters</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.swatch {
  transition: background-color var(--dur) var(--ease);
}
/* Folds open and shut by animating its one grid row between 0fr and 1fr: no height to measure.
   Its child must have no fixed height, or the row can't shrink below it. */
.fold {
  display: grid;
  grid-template-rows: 1fr;
}
.fold > * {
  min-height: 0;
}
.fold-enter-active,
.fold-leave-active {
  transition:
    grid-template-rows var(--dur) var(--ease),
    opacity var(--dur) var(--ease);
}
/* Clipped only while moving, so a focused button's ring isn't cut off at rest. */
.fold-enter-active > *,
.fold-leave-active > * {
  overflow: hidden;
}
.fold-enter-from,
.fold-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}
.legend-action {
  margin-top: 0.625rem;
  width: 100%;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 0.75rem;
  color: var(--text);
}
.legend-action:hover {
  border-color: var(--border-strong);
}
@media (max-width: 639px) {
  .legend-action {
    min-height: 2.75rem;
  }
}
</style>
