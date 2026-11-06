<script setup lang="ts">
/**
 * The When menu's custom range: pick by years, months or days, typing either end or picking it on
 * the calendar. The range is a draft until Apply; it reloads when the slider changes the stored range.
 * Cube mode picks by years only: the cubes hold no months or days of a date range.
 */
import { useStore } from '@nanostores/vue';
import { onBeforeUnmount, ref, useId, watch } from 'vue';
import DatePicker from '~/components/atoms/DatePicker.vue';
import NotInDemoTag from '~/components/atoms/NotInDemoTag.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import {
  endOf,
  formatDate,
  keyUnit,
  parseDateInput,
  resolveRange,
  startOf,
  type DateRange,
  type DateUnit,
} from '~/lib/dates';
import { $cubesOn } from '~/stores/cubes';

type RangeEnd = 'from' | 'to';

const UNITS: { id: DateUnit; label: string }[] = [
  { id: 'y', label: 'Years' },
  { id: 'm', label: 'Months' },
  { id: 'd', label: 'Days' },
];
const EXAMPLE: Record<DateUnit, string> = { y: '2020', m: 'Mar 2020', d: '12 Mar 2020' };
/** How long the "Try a date like…" hint stays after a date that can't be read. */
const TYPE_ERROR_MS = 3000;

/** The stored range, which the draft starts from. */
const props = defineProps<{ range: DateRange | null }>();
const emit = defineEmits<{ apply: [range: DateRange | null]; cancel: []; back: [] }>();

const uniqueId = useId();
const unit = ref<DateUnit>('y');
const cubesOn = useStore($cubesOn);
const from = ref<string | null>(null);
const to = ref<string | null>(null);
/** The end the next calendar pick sets. */
const activeEnd = ref<RangeEnd>('from');
/** Where the calendar shows: moves only when an end is chosen, not after each pick. */
const calendarAt = ref<string | null>(null);

/** What the From and To boxes show; typed text is read on Enter or blur. */
const fromText = ref('');
const toText = ref('');
const typeError = ref('');
let errorTimer: ReturnType<typeof setTimeout> | undefined;

/** Formats an end for its box in the current unit. */
const formatEnd = (iso: string | null) => (iso ? formatDate(iso, unit.value) : '');

/** Puts the draft's ends back in the boxes. */
function syncText() {
  fromText.value = formatEnd(from.value);
  toText.value = formatEnd(to.value);
}

/** Makes an end the one the calendar sets, and shows it there. */
function edit(end: RangeEnd) {
  activeEnd.value = end;
  calendarAt.value = (end === 'from' ? from.value : to.value) ?? from.value ?? to.value;
}

/** Shows the hint for a date that can't be read, for a few seconds. */
function showTypeError() {
  typeError.value = `Try a date like ${EXAMPLE[unit.value]}.`;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (typeError.value = ''), TYPE_ERROR_MS);
}

/** Reads a typed end; a coarser date than the unit covers all of it ("2020" in Days: 1 Jan to 31 Dec). */
function commitText(end: RangeEnd) {
  const text = end === 'from' ? fromText.value : toText.value;
  const key = text.trim() ? parseDateInput(text) : '';
  if (key === null) {
    showTypeError();
    return;
  }
  typeError.value = '';
  if (end === 'from') from.value = key ? startOf(startOf(key, keyUnit(key)), unit.value) : null;
  else to.value = key ? endOf(endOf(key, keyUnit(key)), unit.value) : null;
  if (from.value && to.value && from.value > to.value)
    [from.value, to.value] = [startOf(to.value, unit.value), endOf(from.value, unit.value)];
  syncText();
  edit(end);
}

/** Starts the draft from the stored range (a preset as its days). */
function loadDraft() {
  const current = props.range;
  if (!current) [unit.value, from.value, to.value] = ['y', null, null];
  else if ('preset' in current) {
    const resolved = resolveRange(current);
    [unit.value, from.value, to.value] = ['d', resolved.from, resolved.to];
  } else [unit.value, from.value, to.value] = [current.unit, current.from, current.to];
  typeError.value = '';
  syncText();
  edit('from');
}

/** Switches unit, rounding each end out to it. */
function setUnit(nextUnit: DateUnit) {
  unit.value = nextUnit;
  if (from.value) from.value = startOf(from.value, nextUnit);
  if (to.value) to.value = endOf(to.value, nextUnit);
}

/** A calendar pick sets the active end; picking From moves on to To. */
function pick(key: string) {
  typeError.value = '';
  if (activeEnd.value === 'from') {
    from.value = startOf(key, unit.value);
    if (to.value && to.value < from.value) to.value = null;
    activeEnd.value = 'to';
    return;
  }
  const end = endOf(key, unit.value);
  if (from.value && end < from.value) from.value = startOf(key, unit.value);
  else to.value = end;
}

/** Sends the draft up as the new range, or none when both ends are open. */
function apply() {
  emit('apply', from.value || to.value ? { unit: unit.value, from: from.value, to: to.value } : null);
}

watch([from, to, unit], syncText);
// The slider writes the same store: keep the draft in step.
watch(() => props.range, loadDraft);
loadDraft();
onBeforeUnmount(() => clearTimeout(errorTimer));
</script>

<template>
  <div>
    <button type="button" class="back" @click="emit('back')">
      <UiIcon name="chevron-left" size="1rem" />
      Custom range
    </button>

    <div class="custom-body">
      <fieldset class="units">
        <legend class="sr-only">Pick by</legend>
        <label v-for="unitOption in UNITS" :key="unitOption.id" class="unit">
          <input
            type="radio"
            class="sr-only"
            :name="`${uniqueId}-unit`"
            :checked="unit === unitOption.id"
            :disabled="cubesOn && unitOption.id !== 'y'"
            @change="setUnit(unitOption.id)"
          />
          {{ unitOption.label }}
        </label>
      </fieldset>
      <p v-if="cubesOn" class="demo-note">Months and days<NotInDemoTag /></p>

      <div class="ends">
        <label class="end" :class="{ active: activeEnd === 'from' }">
          <span class="end-label">From</span>
          <input
            v-model="fromText"
            type="text"
            aria-label="From"
            :placeholder="unit === 'y' ? 'Earliest' : 'Any'"
            autocomplete="off"
            :aria-describedby="typeError ? `${uniqueId}-err` : undefined"
            @focus="edit('from')"
            @change="commitText('from')"
            @keydown.enter.prevent="commitText('from')"
          />
        </label>
        <label class="end" :class="{ active: activeEnd === 'to' }">
          <span class="end-label">To</span>
          <input
            v-model="toText"
            type="text"
            aria-label="To"
            placeholder="Today"
            autocomplete="off"
            :aria-describedby="typeError ? `${uniqueId}-err` : undefined"
            @focus="edit('to')"
            @change="commitText('to')"
            @keydown.enter.prevent="commitText('to')"
          />
        </label>
        <p v-if="typeError" :id="`${uniqueId}-err`" class="error" role="alert">{{ typeError }}</p>
      </div>

      <DatePicker :unit="unit" :from="from" :to="to" :at="calendarAt" @pick="pick" />

      <div class="footer">
        <button type="button" class="link" :disabled="!from && !to" @click="from = to = null">Clear</button>
        <span class="flex gap-1">
          <button type="button" class="btn" @click="emit('cancel')">Cancel</button>
          <button type="button" class="btn primary" @click="apply">Apply</button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  padding: 0.125rem 0.125rem 0.25rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--text);
}
.back svg {
  color: var(--text-muted);
}
.custom-body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem 0.375rem 0.125rem;
}
.units {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  /* The selected fill runs edge to edge; the rounding clips its outer corners. */
  overflow: hidden;
}
.unit {
  position: relative;
  display: grid;
  place-items: center;
  height: 1.625rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  cursor: pointer;
}
.unit:has(:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}
.demo-note {
  margin-top: 0.25rem;
  color: var(--text-subtle);
  font-size: 0.75rem;
}
.unit:hover {
  color: var(--text);
}
.unit:has(:checked) {
  color: var(--text);
  background: var(--accent-soft);
}
.unit:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.ends {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 0.5rem;
  margin-top: 0.25rem;
}
.end {
  position: relative;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: text;
}
.end.active {
  border-color: var(--accent);
}
.end:has(input:focus-visible) {
  border-color: transparent;
  outline: 2px solid var(--focus);
  outline-offset: 0;
}
.end input {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.end input::placeholder {
  color: var(--text-subtle);
}
.end-label {
  display: block;
  font-size: 0.6875rem;
  line-height: 1rem;
  color: var(--text-subtle);
}
/* Floats over the calendar's top edge so showing it doesn't shift the layout. */
.error {
  position: absolute;
  top: calc(100% + 0.125rem);
  left: 0;
  right: 0;
  z-index: 1;
  padding: 0.125rem 0.375rem;
  background: var(--surface);
  font-size: 0.75rem;
  color: var(--danger);
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
  padding-top: 0.375rem;
  border-top: 1px solid var(--border);
}
.link {
  padding: 0 0.25rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.link:not(:disabled):hover {
  color: var(--text);
  text-decoration: underline;
}
.link:disabled {
  opacity: 0.5;
}
.btn {
  height: 1.625rem;
  padding: 0 0.625rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--text);
}
.btn:hover {
  border-color: var(--border-strong);
}
.btn.primary {
  border-color: var(--accent);
  background: var(--accent-soft);
}
@media (pointer: coarse) {
  .unit,
  .btn {
    min-height: 2.75rem;
  }
  .back {
    min-height: 2.75rem;
    padding: 0.5rem 0.5rem 0.625rem;
  }
}
</style>
