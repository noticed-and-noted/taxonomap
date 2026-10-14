<script setup lang="ts">
/**
 * What's near me (client:only). The persisted map switches to "pin" mode:
 * click to drop a pin, or use geolocation after an explainer. Location is
 * rounded to 3 dp before any use. Panel: sortable species table, recent
 * sightings, personal checklist, share card.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { full } from '~/lib/format';
import { classifyError, RADIUS_STEPS_KM, type UiErrorKind } from '~/lib/gbif';
import { checklistCsv, $checklist, clearChecklist, storageAvailable, toggleSeen } from '~/lib/near/checklist';
import {
  classesNear,
  NEAR_CLASSES,
  NEAR_PER_CLASS,
  recentSightings,
  speciesNear,
  speciesTallies,
  type Area,
  type ClassGroup,
  type Sighting,
  type SpeciesRow,
} from '~/lib/near/data';
import { $speciesManifest, loadSpeciesManifest, speciesPath } from '~/lib/species/links';
import { $flyTo, $mapMode } from '~/stores/explorer';
import { $nearAt, $nearRadius, $nearTab, $nearThisMonth, setNearLocation, zoomForRadius } from '~/stores/near';
import LicenceBadge from './LicenceBadge.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import ShareDialog from './ShareDialog.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesTable from './SpeciesTable.vue';
import ThumbImage from './ThumbImage.vue';

const at = useStore($nearAt);
const radius = useStore($nearRadius);
const thisMonth = useStore($nearThisMonth);
const tab = useStore($nearTab);
const checklist = useStore($checklist);
const manifest = useStore($speciesManifest);

const MONTH = new Date().getMonth() + 1;
const monthName = new Date().toLocaleString('en', { month: 'long' });

const panelOpen = ref(true);
const geoState = ref<'idle' | 'asking' | 'denied' | 'unavailable'>('idle');
const loading = ref(false);
const error = ref<UiErrorKind | null>(null);
const total = ref(0);

const classes = shallowRef<ClassGroup[]>([]);
const species = shallowRef<SpeciesRow[]>([]);
const recent = shallowRef<Sighting[] | null>(null);
const recentLoading = ref(false);
const recentError = ref(false);
const shareOpen = ref(false);
const tallies = shallowRef<Awaited<ReturnType<typeof speciesTallies>> | null>(null);
const canStore = ref(true);
let seq = 0;
/** Aborts the previous area's remaining requests when the pin or radius changes. */
let ctrl: AbortController | undefined;

const area = computed<Area | null>(() =>
  at.value
    ? { lat: at.value.lat, lng: at.value.lng, radiusKm: radius.value, ...(thisMonth.value && { month: MONTH }) }
    : null,
);
const radiusIndex = computed(() => (RADIUS_STEPS_KM as readonly number[]).indexOf(radius.value));
const tableNote = computed(() =>
  classes.value.length > NEAR_CLASSES
    ? `top ${NEAR_PER_CLASS} in each of the ${NEAR_CLASSES} most-recorded groups`
    : `top ${NEAR_PER_CLASS} in each group`,
);
const checklistEntries = computed(() => Object.values(checklist.value).sort((a, b) => b.seen.localeCompare(a.seen)));

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

async function loadArea() {
  const a = area.value;
  const mine = ++seq;
  ctrl?.abort();
  ctrl = new AbortController();
  const { signal } = ctrl;
  classes.value = [];
  species.value = [];
  recent.value = null;
  tallies.value = null;
  error.value = null;
  if (!a) return;
  $flyTo.set({ kind: 'point', lng: a.lng, lat: a.lat, zoom: zoomForRadius(a.radiusKm) });
  loading.value = true;
  try {
    const r = await classesNear(a, signal);
    if (mine !== seq) return;
    total.value = r.records;
    if (tab.value === 'recent') void loadRecent();
    const rows = await speciesNear(a, r.classes, signal);
    if (mine !== seq) return;
    classes.value = r.classes;
    species.value = rows;
    loading.value = false;
  } catch (e) {
    if (mine === seq) error.value = classifyError(e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

async function loadRecent() {
  const a = area.value;
  if (!a || recentLoading.value) return;
  recentLoading.value = true;
  recentError.value = false;
  try {
    recent.value = await recentSightings(a);
  } catch {
    recentError.value = true;
  } finally {
    recentLoading.value = false;
  }
}

async function openShare() {
  const a = area.value;
  if (!a) return;
  shareOpen.value = true;
  if (!tallies.value) tallies.value = await speciesTallies(a, classes.value).catch(() => null);
}

function exportCsv() {
  const blob = new Blob([checklistCsv(checklistEntries.value)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gbif-explorer-checklist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function confirmClear() {
  if (window.confirm('Remove every species from your checklist?')) clearChecklist();
}

const setTab = (t: 'species' | 'recent' | 'checklist') => {
  $nearTab.set(t);
  if (t === 'recent' && !recent.value) void loadRecent();
};
const toggleMonth = () => $nearThisMonth.set(!thisMonth.value);

watch(area, () => void loadArea(), { deep: true });

onMounted(() => {
  $mapMode.set('pin');
  canStore.value = storageAvailable();
  void loadSpeciesManifest();
  void loadArea();
});

onBeforeUnmount(() => {
  $mapMode.set('explore');
  ctrl?.abort();
});
</script>

<template>
  <div class="near-explorer pointer-events-none absolute inset-0 z-10">
    <button
      v-if="!panelOpen"
      type="button"
      class="pointer-events-auto absolute right-3 top-3 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-panel"
      @click="panelOpen = true"
    >
      Show list
    </button>

    <div class="pointer-events-auto">
      <ResponsivePanel title="What’s near me" :open="panelOpen" @close="panelOpen = false">
        <!-- No location yet: explainer -->
        <section v-if="!at" class="space-y-4 text-sm">
          <p>See which species have been recorded around a place, ranked by how often they’ve been seen.</p>
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
        <section v-else class="space-y-4">
          <div class="space-y-3 text-sm">
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
            <p class="text-xs text-subtle">Click the map to move the pin.</p>
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
              v-for="t in ['species', 'recent', 'checklist'] as const"
              :key="t"
              role="tab"
              type="button"
              :aria-selected="tab === t"
              class="-mb-px border-b-2 px-3 py-1.5"
              :class="tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'"
              @click="setTab(t)"
            >
              {{ t === 'checklist' ? `Seen (${checklistEntries.length})` : t === 'species' ? 'Species' : 'Recent' }}
            </button>
          </div>

          <!-- Species -->
          <div v-if="tab === 'species'" role="tabpanel">
            <div v-if="error" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
              GBIF is busy right now. <button type="button" class="underline" @click="loadArea">Try again</button>
            </div>
            <p v-else-if="!loading && !species.length" class="rounded-md bg-surface-2 p-3 text-sm text-muted">
              No records here yet{{ thisMonth ? ` for ${monthName}` : '' }}. Try a larger radius{{
                thisMonth ? ' or all months' : ''
              }}.
            </p>
            <SpeciesTable v-else :rows="species" :groups="classes" :loading="loading" :note="tableNote" checklist />
          </div>

          <!-- Recent sightings -->
          <div v-else-if="tab === 'recent'" role="tabpanel">
            <div v-if="recentLoading" class="space-y-2"><SkeletonBlock v-for="i in 4" :key="i" height="5rem" /></div>
            <p v-else-if="recentError" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
              Recent sightings are unavailable right now.
              <button type="button" class="underline" @click="loadRecent">Try again</button>
            </p>
            <p v-else-if="recent && !recent.length" class="rounded-md bg-surface-2 p-3 text-sm text-muted">
              No photographed records from the past year here. Try a larger radius.
            </p>
            <ul v-else-if="recent" class="space-y-2">
              <li v-for="r in recent" :key="r.occurrence.key" class="flex gap-3 rounded-md bg-surface-2 p-2">
                <a
                  :href="`https://www.gbif.org/occurrence/${r.occurrence.key}`"
                  target="_blank"
                  rel="noopener"
                  class="size-20 shrink-0 overflow-hidden rounded bg-photo"
                >
                  <ThumbImage
                    :image="r.image"
                    size="200x"
                    :alt="r.commonName ?? r.occurrence.species ?? ''"
                    class="size-full object-cover"
                  />
                </a>
                <div class="min-w-0 text-sm">
                  <p class="truncate font-medium">
                    {{ r.commonName ?? r.occurrence.species ?? r.occurrence.scientificName }}
                  </p>
                  <p v-if="r.commonName" class="sci-name truncate text-xs text-muted">{{ r.occurrence.species }}</p>
                  <p class="text-xs text-subtle">
                    {{ r.date }}<span v-if="r.datasetTitle"> · {{ r.datasetTitle }}</span>
                  </p>
                  <LicenceBadge
                    class="mt-1"
                    :licence="r.image.licence"
                    :creator="r.image.creator"
                    :rights-holder="r.image.rightsHolder"
                  />
                </div>
              </li>
            </ul>
          </div>

          <!-- Checklist -->
          <div v-else role="tabpanel" class="space-y-3 text-sm">
            <p v-if="!canStore" class="rounded-md bg-surface-2 p-3 text-xs text-muted">
              This browser won’t let the site save data, so your checklist lasts only until you leave the page.
            </p>
            <p v-if="!checklistEntries.length" class="text-muted">
              Tick “Seen” on any species card to build your checklist. It stays in this browser only.
            </p>
            <template v-else>
              <ul class="divide-y divide-border">
                <li v-for="e in checklistEntries" :key="e.key" class="flex items-center justify-between gap-2 py-1.5">
                  <a :href="speciesPath(e.key, manifest)" class="min-w-0 truncate hover:underline">
                    {{ e.commonName ?? e.scientificName }}
                    <span v-if="e.commonName" class="sci-name text-xs text-subtle">{{ e.scientificName }}</span>
                  </a>
                  <span class="flex shrink-0 items-center gap-2 text-xs text-subtle">
                    {{ e.seen }}
                    <button
                      type="button"
                      class="rounded px-1 hover:bg-surface-2"
                      :aria-label="`Remove ${e.commonName ?? e.scientificName}`"
                      @click="toggleSeen(e)"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              </ul>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast"
                  @click="exportCsv"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  class="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
                  @click="confirmClear"
                >
                  Clear
                </button>
              </div>
            </template>
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
