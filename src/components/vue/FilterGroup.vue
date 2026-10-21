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
import { markDone } from '~/stores/onboarding';
import { TAXON_GROUPS, toggleTaxa, type TaxonGroup } from '~/stores/taxon';
import type { FilterGroupId } from './filterGroups';
import TaxaPicker from './TaxaPicker.vue';
import TimeSlider from './TimeSlider.vue';
import WhenMenu from './WhenMenu.vue';

defineProps<{ group: FilterGroupId }>();

// Unique per instance: the rail and the sheet can both render a group.
const uniqueId = useId();

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

const groupOn = (group: TaxonGroup) => group.taxa.every((taxon) => taxonKeys.value.includes(taxon.key));
/** Set when a group would take the What filter past MAX_TAXA. */
const groupsFull = ref(false);
function toggleGroup(group: TaxonGroup) {
  const result = toggleTaxa(group.taxa);
  groupsFull.value = result === 'full';
  if (result === 'added') markDone('group');
}
watch(taxonKeys, () => (groupsFull.value = false));

function toggleIn<T>(store: WritableAtom<T[]>, value: T, sort?: (left: T, right: T) => number) {
  const current = store.get();
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  store.set(next.sort(sort));
}

// Vue does not expose $-prefixed setup bindings to templates in dev mode.
const toggleIucn = (value: (typeof IUCN_CATEGORIES)[number]) => toggleIn($iucn, value);
const toggleMonth = (month: number) => toggleIn($months, month, (left, right) => left - right);
const toggleContinent = (value: (typeof CONTINENTS)[number]) => toggleIn($continents, value);
const toggleBasis = (value: (typeof BASIS_OF_RECORD)[number]) => toggleIn($basisOfRecord, value);
const setUncert = (metres: number | null) => $maxUncertainty.set(metres);
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
            v-for="taxonGroup in TAXON_GROUPS"
            :key="taxonGroup.label"
            type="button"
            class="group-tile"
            :aria-pressed="groupOn(taxonGroup)"
            @click="toggleGroup(taxonGroup)"
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
              <path :d="taxonGroup.icon" />
            </svg>
            {{ taxonGroup.label }}
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
        <label v-for="category in IUCN_CATEGORIES" :key="category" class="check-row">
          <input type="checkbox" :checked="iucn.includes(category)" @change="toggleIucn(category)" />
          <span class="iucn-code">{{ category }}</span>
          {{ IUCN_LABELS[category] }}
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

      <fieldset :disabled="!monthsOn" :aria-describedby="`${uniqueId}-months-hint`">
        <legend class="group-label flex w-full justify-between">
          Months
          <button v-if="months.length" type="button" class="link-btn" @click="clearMonths">Clear</button>
        </legend>
        <div class="grid grid-cols-6 gap-1">
          <button
            v-for="(monthLabel, index) in MONTHS"
            :key="monthLabel"
            type="button"
            class="toggle month"
            :aria-pressed="months.includes(index + 1)"
            :aria-label="MONTH_NAMES[index]"
            @click="toggleMonth(index + 1)"
          >
            {{ monthLabel }}
          </button>
        </div>
        <p :id="`${uniqueId}-months-hint`" class="hint">
          {{ monthsOn ? 'In any year. Pick several for a season.' : 'Select a date range in years to filter by month' }}
        </p>
      </fieldset>
    </template>

    <template v-else-if="group === 'where'">
      <fieldset>
        <legend class="group-label">Continent</legend>
        <label v-for="continent in CONTINENTS" :key="continent" class="check-row">
          <input type="checkbox" :checked="continents.includes(continent)" @change="toggleContinent(continent)" />
          {{ CONTINENT_LABELS[continent] }}
        </label>
      </fieldset>

      <fieldset>
        <legend class="group-label">Location accuracy</legend>
        <div class="flex flex-wrap gap-1">
          <label class="toggle radio">
            <input
              type="radio"
              class="sr-only"
              :name="`${uniqueId}-uncert`"
              :checked="uncert === null"
              @change="setUncert(null)"
            />
            Any
          </label>
          <label v-for="metres in UNCERTAINTY_STEPS_M" :key="metres" class="toggle radio">
            <input
              type="radio"
              class="sr-only"
              :name="`${uniqueId}-uncert`"
              :checked="uncert === metres"
              @change="setUncert(metres)"
            />
            ≤ {{ distance(metres) }}
          </label>
        </div>
        <p class="hint">Hides records without a stated uncertainty.</p>
      </fieldset>
    </template>

    <template v-else-if="group === 'how'">
      <fieldset>
        <legend class="group-label">Record type</legend>
        <label v-for="recordBasis in BASIS_OF_RECORD" :key="recordBasis" class="check-row">
          <input type="checkbox" :checked="basis.includes(recordBasis)" @change="toggleBasis(recordBasis)" />
          {{ BASIS_LABELS[recordBasis] }}
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
