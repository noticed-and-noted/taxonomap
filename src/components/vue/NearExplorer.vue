<script setup lang="ts">
/**
 * What's near me (client:only). The persisted map switches to "pin" mode:
 * click to drop a pin, or use geolocation after an explainer. Location is
 * rounded to 3 dp before any use. Panel: species by class (infinite
 * scroll), recent sightings, personal checklist, share card.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { compact, full } from '~/lib/format';
import { classifyError, RADIUS_STEPS_KM, type UiErrorKind } from '~/lib/gbif';
import { checklistCsv, $checklist, clearChecklist, storageAvailable, toggleSeen } from '~/lib/near/checklist';
import {
  classesNear,
  recentSightings,
  speciesPage,
  speciesTallies,
  type Area,
  type ClassGroup,
  type NearSpecies,
  type Sighting,
} from '~/lib/near/data';
import { $speciesManifest, loadSpeciesManifest, speciesPath } from '~/lib/species/links';
import { $flyTo, $mapMode } from '~/stores/explorer';
import { $nearAt, $nearRadius, $nearTab, $nearThisMonth, setNearLocation, zoomForRadius } from '~/stores/near';
import LicenceBadge from './LicenceBadge.vue';
import ResponsivePanel from './ResponsivePanel.vue';
import ShareDialog from './ShareDialog.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import SpeciesCard from './SpeciesCard.vue';
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

interface Section {
  group: ClassGroup;
  species: NearSpecies[];
  more: boolean;
  loading: boolean;
}
const sections = shallowRef<Section[]>([]);
const visibleSections = ref(0);
const recent = shallowRef<Sighting[] | null>(null);
const recentLoading = ref(false);
const recentError = ref(false);
const shareOpen = ref(false);
const tallies = shallowRef<Awaited<ReturnType<typeof speciesTallies>> | null>(null);
const canStore = ref(true);
const sentinel = ref<HTMLElement>();
let io: IntersectionObserver | undefined;
let seq = 0;

const area = computed<Area | null>(() =>
  at.value
    ? { lat: at.value.lat, lng: at.value.lng, radiusKm: radius.value, ...(thisMonth.value && { month: MONTH }) }
    : null,
);
const radiusIndex = computed(() => (RADIUS_STEPS_KM as readonly number[]).indexOf(radius.value));
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
  sections.value = [];
  recent.value = null;
  tallies.value = null;
  error.value = null;
  if (!a) return;
  $flyTo.set({ kind: 'point', lng: a.lng, lat: a.lat, zoom: zoomForRadius(a.radiusKm) });
  loading.value = true;
  try {
    const r = await classesNear(a);
    if (mine !== seq) return;
    total.value = r.records;
    sections.value = r.classes.map((group) => ({ group, species: [], more: true, loading: false }));
    visibleSections.value = 0;
    await revealMore(mine);
    if (tab.value === 'recent') void loadRecent();
  } catch (e) {
    if (mine === seq) error.value = classifyError(e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

async function loadSection(i: number, mine = seq) {
  const s = sections.value[i];
  const a = area.value;
  if (!s || !a || s.loading || !s.more) return;
  s.loading = true;
  sections.value = [...sections.value];
  try {
    const page = await speciesPage(a, s.group.key, s.species.length);
    if (mine !== seq) return;
    s.species = [...s.species, ...page.species];
    s.more = page.more;
  } catch {
    s.more = false;
  } finally {
    s.loading = false;
    if (mine === seq) sections.value = [...sections.value];
  }
}

/** Infinite scroll: reveal (and load) the next class section. */
async function revealMore(mine = seq) {
  if (visibleSections.value >= sections.value.length) return;
  const i = visibleSections.value;
  visibleSections.value++;
  await loadSection(i, mine);
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
  if (!tallies.value)
    tallies.value = await speciesTallies(
      a,
      sections.value.map((s) => s.group),
    ).catch(() => null);
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
const seen = (k: number) => !!checklist.value[String(k)];

watch(area, () => void loadArea(), { deep: true });

onMounted(() => {
  $mapMode.set('pin');
  canStore.value = storageAvailable();
  void loadSpeciesManifest();
  void loadArea();
  io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void revealMore();
  });
  watch(
    sentinel,
    (el, old) => {
      if (old) io?.unobserve(old);
      if (el) io?.observe(el);
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => {
  $mapMode.set('explore');
  io?.disconnect();
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
              <button type="button" class="chip ml-auto" :disabled="!sections.length" @click="openShare">Share</button>
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

          <!-- Species by class -->
          <div v-if="tab === 'species'" role="tabpanel">
            <div v-if="error" class="rounded-md bg-surface-2 p-3 text-sm text-muted" role="alert">
              GBIF is busy right now. <button type="button" class="underline" @click="loadArea">Try again</button>
            </div>
            <div v-else-if="loading" class="grid grid-cols-2 gap-2">
              <SkeletonBlock v-for="i in 6" :key="i" height="10rem" />
            </div>
            <p v-else-if="!sections.length" class="rounded-md bg-surface-2 p-3 text-sm text-muted">
              No records here yet{{ thisMonth ? ` for ${monthName}` : '' }}. Try a larger radius{{
                thisMonth ? ' or all months' : ''
              }}.
            </p>
            <template v-else>
              <section v-for="s in sections.slice(0, visibleSections)" :key="s.group.key" class="mb-6">
                <h3 class="mb-2 flex items-baseline justify-between gap-2">
                  <span class="font-display text-lg">{{ s.group.common ?? s.group.name }}</span>
                  <span class="text-xs text-subtle">{{ compact(s.group.records) }} records</span>
                </h3>
                <ul class="grid grid-cols-2 gap-2">
                  <li v-for="sp in s.species" :key="sp.key" class="relative">
                    <SpeciesCard
                      :species-key="sp.key"
                      :scientific-name="sp.scientificName"
                      :common-name="sp.commonName"
                      :count="sp.records"
                      :image="sp.image"
                      size="200x"
                      :href="speciesPath(sp.key, manifest)"
                    />
                    <label
                      class="seen absolute right-1.5 top-1.5 flex cursor-pointer items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white"
                    >
                      <input
                        type="checkbox"
                        class="accent-[var(--accent)]"
                        :checked="seen(sp.key)"
                        @change="
                          toggleSeen({
                            key: sp.key,
                            scientificName: sp.scientificName,
                            ...(sp.commonName && { commonName: sp.commonName }),
                          })
                        "
                      />
                      Seen<span class="sr-only"> {{ sp.commonName ?? sp.scientificName }}</span>
                    </label>
                  </li>
                </ul>
                <button
                  v-if="s.more"
                  type="button"
                  class="mt-2 w-full rounded-md border border-border py-1.5 text-xs text-muted hover:border-accent"
                  :disabled="s.loading"
                  @click="loadSection(sections.indexOf(s))"
                >
                  {{ s.loading ? 'Loading…' : `More ${s.group.common ?? s.group.name}` }}
                </button>
              </section>
              <div ref="sentinel" class="h-8" aria-hidden="true"></div>
              <p v-if="visibleSections < sections.length" class="text-center text-xs text-subtle">
                Scroll for more groups…
              </p>
            </template>
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
