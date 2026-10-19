<script setup lang="ts">
/**
 * The controls for one filter group. Rendered in the rail's flyout on
 * desktop and stacked in the Filters sheet on phones. Every control writes a
 * URL-synced store.
 */
import { useStore } from '@nanostores/vue';
import type { WritableAtom } from 'nanostores';
import { computed, ref, useId, watch } from 'vue';
import { BASIS_LABELS, CONTINENT_LABELS, distance, IUCN_LABELS, MONTH_NAMES, MONTHS } from '~/lib/format';
import {
  $basisOfRecord,
  $continents,
  $exactTaxon,
  $hasPhoto,
  $hasSound,
  $iucn,
  $maxUncertainty,
  $months,
  monthsAllowed,
  $taxonKeys,
  $dateRange,
  BASIS_OF_RECORD,
  CONTINENTS,
  IUCN_CATEGORIES,
  MAX_TAXA,
  UNCERTAINTY_STEPS_M,
} from '~/stores/explorer';
import { TAXON_GROUPS, toggleTaxa, type TaxonGroup } from '~/stores/taxon';
import type { FilterGroupId } from './filterGroups';
import TaxaPicker from './TaxaPicker.vue';
import TimeSlider from './TimeSlider.vue';
import WhenMenu from './WhenMenu.vue';

defineProps<{ group: FilterGroupId }>();

// Unique per instance: the rail and the sheet can both render a group.
const uid = useId();

const iucn = useStore($iucn);
const exact = useStore($exactTaxon);
const dateRange = useStore($dateRange);
const months = useStore($months);
const monthsOn = computed(() => monthsAllowed(dateRange.value));
const continents = useStore($continents);
const uncert = useStore($maxUncertainty);
const basis = useStore($basisOfRecord);
const photo = useStore($hasPhoto);
const sound = useStore($hasSound);
const taxonKeys = useStore($taxonKeys);

const groupOn = (g: TaxonGroup) => g.taxa.every((t) => taxonKeys.value.includes(t.key));
/** Set when a group would take the What filter past MAX_TAXA. */
const groupsFull = ref(false);
function toggleGroup(g: TaxonGroup) {
  groupsFull.value = toggleTaxa(g.taxa) === 'full';
}
watch(taxonKeys, () => (groupsFull.value = false));

function toggleIn<T>(store: WritableAtom<T[]>, value: T, sort?: (a: T, b: T) => number) {
  const cur = store.get();
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  store.set(next.sort(sort));
}

// Vue does not expose $-prefixed setup bindings to templates in dev mode.
const toggleIucn = (v: (typeof IUCN_CATEGORIES)[number]) => toggleIn($iucn, v);
const toggleMonth = (m: number) => toggleIn($months, m, (a, b) => a - b);
const toggleContinent = (v: (typeof CONTINENTS)[number]) => toggleIn($continents, v);
const toggleBasis = (v: (typeof BASIS_OF_RECORD)[number]) => toggleIn($basisOfRecord, v);
const setUncert = (m: number | null) => $maxUncertainty.set(m);
const toggleExact = () => $exactTaxon.set(!exact.value);
const togglePhoto = () => $hasPhoto.set(!photo.value);
const toggleSound = () => $hasSound.set(!sound.value);
const clearMonths = () => $months.set([]);

const clearDates = () => $dateRange.set(null);
</script>

<template>
  <div class="filter-group space-y-5 text-sm">
    <template v-if="group === 'what'">
      <TaxaPicker />

      <fieldset>
        <legend class="group-label">Groups</legend>
        <!-- Three across: the nine animal groups fill three rows, plants, mosses and fungi the fourth. -->
        <div class="grid grid-cols-3 gap-0.5">
          <button
            v-for="g in TAXON_GROUPS"
            :key="g.label"
            type="button"
            class="group-tile"
            :aria-pressed="groupOn(g)"
            @click="toggleGroup(g)"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="g.icon" />
            </svg>
            {{ g.label }}
          </button>
        </div>
        <p v-if="groupsFull" class="hint" role="alert">
          Up to {{ MAX_TAXA }} taxa at once. Remove one to add this group.
        </p>
      </fieldset>

      <fieldset>
        <legend class="group-label">Taxon match</legend>
        <label class="check-row">
          <input type="checkbox" :checked="exact" @change="toggleExact" />
          Exact taxon only
        </label>
        <p class="hint">Leaves out subspecies and lower ranks, e.g. domestic dogs filed under gray wolf.</p>
      </fieldset>

      <fieldset>
        <legend class="group-label">IUCN Red List</legend>
        <label v-for="c in IUCN_CATEGORIES" :key="c" class="check-row">
          <input type="checkbox" :checked="iucn.includes(c)" @change="toggleIucn(c)" />
          <span class="iucn-code">{{ c }}</span>
          {{ IUCN_LABELS[c] }}
        </label>
        <p class="hint">Global category of each record's species.</p>
      </fieldset>
    </template>

    <template v-else-if="group === 'when'">
      <fieldset>
        <legend class="group-label flex w-full justify-between">
          Dates
          <button v-if="dateRange" type="button" class="link-btn" @click="clearDates">Clear</button>
        </legend>
        <TimeSlider>
          <template #label="{ live }"><WhenMenu :live="live" /></template>
        </TimeSlider>
      </fieldset>

      <fieldset :disabled="!monthsOn" :aria-describedby="`${uid}-months-hint`">
        <legend class="group-label flex w-full justify-between">
          Months
          <button v-if="months.length" type="button" class="link-btn" @click="clearMonths">Clear</button>
        </legend>
        <div class="grid grid-cols-6 gap-1">
          <button
            v-for="(m, i) in MONTHS"
            :key="m"
            type="button"
            class="toggle month"
            :aria-pressed="months.includes(i + 1)"
            :aria-label="MONTH_NAMES[i]"
            @click="toggleMonth(i + 1)"
          >
            {{ m }}
          </button>
        </div>
        <p :id="`${uid}-months-hint`" class="hint">
          {{ monthsOn ? 'In any year. Pick several for a season.' : 'Select a date range in years to filter by month' }}
        </p>
      </fieldset>
    </template>

    <template v-else-if="group === 'where'">
      <fieldset>
        <legend class="group-label">Continent</legend>
        <label v-for="c in CONTINENTS" :key="c" class="check-row">
          <input type="checkbox" :checked="continents.includes(c)" @change="toggleContinent(c)" />
          {{ CONTINENT_LABELS[c] }}
        </label>
      </fieldset>

      <fieldset>
        <legend class="group-label">Location accuracy</legend>
        <div class="flex flex-wrap gap-1">
          <label class="toggle radio">
            <input
              type="radio"
              class="sr-only"
              :name="`${uid}-uncert`"
              :checked="uncert === null"
              @change="setUncert(null)"
            />
            Any
          </label>
          <label v-for="m in UNCERTAINTY_STEPS_M" :key="m" class="toggle radio">
            <input
              type="radio"
              class="sr-only"
              :name="`${uid}-uncert`"
              :checked="uncert === m"
              @change="setUncert(m)"
            />
            ≤ {{ distance(m) }}
          </label>
        </div>
        <p class="hint">Hides records without a stated uncertainty.</p>
      </fieldset>
    </template>

    <template v-else-if="group === 'how'">
      <fieldset>
        <legend class="group-label">Record type</legend>
        <label v-for="b in BASIS_OF_RECORD" :key="b" class="check-row">
          <input type="checkbox" :checked="basis.includes(b)" @change="toggleBasis(b)" />
          {{ BASIS_LABELS[b] }}
        </label>
      </fieldset>

      <fieldset>
        <legend class="group-label">Media</legend>
        <div class="flex flex-wrap gap-1">
          <button type="button" class="toggle" :aria-pressed="photo" @click="togglePhoto">Has photo</button>
          <button type="button" class="toggle" :aria-pressed="sound" @click="toggleSound">Has sound</button>
        </div>
        <p class="hint">With both on, records with either are kept.</p>
      </fieldset>
    </template>
  </div>
</template>

<style scoped>
.group-label {
  margin-bottom: 0.375rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
}

.hint {
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-subtle);
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 -0.5rem;
  padding: 0.3125rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.check-row:hover {
  background: var(--surface-2);
}
.check-row input {
  accent-color: var(--accent);
}

.iucn-code {
  min-width: 1.75rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
}

.link-btn {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-muted);
}
.link-btn:hover {
  color: var(--text);
  text-decoration: underline;
}

.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.875rem;
  padding: 0 0.625rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.toggle:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}
.toggle.month {
  padding: 0;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
}
.toggle[aria-pressed='true'],
.toggle.radio:has(:checked) {
  color: var(--text);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}
.group-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.125rem;
  /* The 44 px touch target; no taller, so all twelve groups stay compact. */
  min-height: 2.75rem;
  padding: 0.1875rem 0 0.125rem;
  line-height: 1rem;
  border-radius: var(--radius);
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.6875rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease);
}
.group-tile:hover {
  color: var(--text);
  background: var(--surface-2);
}
.group-tile[aria-pressed='true'] {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.group-tile[aria-pressed='true'] svg {
  color: var(--accent);
}
.toggle.radio:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
