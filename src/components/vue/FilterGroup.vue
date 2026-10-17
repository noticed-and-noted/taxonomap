<script setup lang="ts">
/**
 * The controls for one filter group. Rendered in the rail's flyout on
 * desktop and stacked in the Filters sheet on phones. Every control writes a
 * URL-synced store.
 */
import { useStore } from '@nanostores/vue';
import type { WritableAtom } from 'nanostores';
import { ref, useId, watch } from 'vue';
import {
  BASIS_LABELS,
  CONTINENT_LABELS,
  distance,
  IUCN_LABELS,
  MONTH_NAMES,
  MONTHS,
} from '~/lib/format';
import {
  $basisOfRecord,
  $continents,
  $hasPhoto,
  $hasSound,
  $iucn,
  $maxUncertainty,
  $months,
  $yearRange,
  BASIS_OF_RECORD,
  CONTINENTS,
  IUCN_CATEGORIES,
  UNCERTAINTY_STEPS_M,
} from '~/stores/explorer';
import type { FilterGroupId } from './filterGroups';
import TaxaPicker from './TaxaPicker.vue';

defineProps<{ group: FilterGroupId }>();

// Unique per instance: the rail and the sheet can both render a group.
const uid = useId();

const iucn = useStore($iucn);
const years = useStore($yearRange);
const months = useStore($months);
const continents = useStore($continents);
const uncert = useStore($maxUncertainty);
const basis = useStore($basisOfRecord);
const photo = useStore($hasPhoto);
const sound = useStore($hasSound);

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
const togglePhoto = () => $hasPhoto.set(!photo.value);
const toggleSound = () => $hasSound.set(!sound.value);
const clearMonths = () => $months.set([]);

/* Year inputs: edit freely, commit on change (blur / Enter), like the slider. */
const MIN_YEAR = 1600;
const MAX_YEAR = new Date().getFullYear();
const fromYear = ref<number | ''>(years.value?.[0] ?? '');
const toYear = ref<number | ''>(years.value?.[1] ?? '');
watch(years, (r) => {
  fromYear.value = r?.[0] ?? '';
  toYear.value = r?.[1] ?? '';
});

function clampYear(v: number | ''): number | null {
  if (v === '' || !Number.isFinite(v)) return null;
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, Math.round(v)));
}

function commitYears() {
  const a = clampYear(fromYear.value);
  const b = clampYear(toYear.value);
  if (a === null && b === null) {
    $yearRange.set(null);
    return;
  }
  const lo = a ?? MIN_YEAR;
  const hi = b ?? MAX_YEAR;
  $yearRange.set([Math.min(lo, hi), Math.max(lo, hi)]);
  // Reflect the clamped / swapped values even when the store did not change.
  fromYear.value = Math.min(lo, hi);
  toYear.value = Math.max(lo, hi);
}

const clearYears = () => $yearRange.set(null);
</script>

<template>
  <div class="filter-group space-y-5 text-sm">
    <template v-if="group === 'what'">
      <TaxaPicker />

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
          Years
          <button v-if="years" type="button" class="link-btn" @click="clearYears">Clear</button>
        </legend>
        <div class="flex items-center gap-2">
          <label class="sr-only" :for="`${uid}-from`">Earliest year</label>
          <input
            :id="`${uid}-from`"
            v-model.number="fromYear"
            type="number"
            inputmode="numeric"
            class="year-input"
            :min="MIN_YEAR"
            :max="MAX_YEAR"
            placeholder="Earliest"
            @change="commitYears"
          />
          <span class="text-muted" aria-hidden="true">–</span>
          <label class="sr-only" :for="`${uid}-to`">Latest year</label>
          <input
            :id="`${uid}-to`"
            v-model.number="toYear"
            type="number"
            inputmode="numeric"
            class="year-input"
            :min="MIN_YEAR"
            :max="MAX_YEAR"
            placeholder="Latest"
            @change="commitYears"
          />
        </div>
        <p class="hint">Or drag the records-per-year timeline.</p>
      </fieldset>

      <fieldset>
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
        <p class="hint">In any year. Pick several for a season.</p>
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

.year-input {
  width: 100%;
  min-width: 0;
  height: 2rem;
  padding: 0 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.year-input:hover {
  border-color: var(--border-strong);
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
.toggle.radio:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
