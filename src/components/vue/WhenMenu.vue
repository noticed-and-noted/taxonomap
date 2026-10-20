<script setup lang="ts">
/**
 * The When filter's date menu: the range label under the year slider opens a
 * floating list of rolling presets plus "Custom range", where a range is typed
 * or picked by year, month or day. It writes $dateRange, which the slider also
 * writes, so moving the slider updates the menu (and an open custom range).
 *
 * The panel floats (teleported to <body>, fixed) under the nearest positioned
 * ancestor (the slider), so opening it never pushes the controls below it
 * down and the flyout's scroll box can't clip it.
 */
import { useStore } from '@nanostores/vue';
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import {
  endOf,
  formatDate,
  keyUnit,
  parseDateInput,
  PRESETS,
  rangeLabel,
  resolveRange,
  startOf,
  type DateUnit,
  type Preset,
} from '~/lib/dates';
import { $dateRange } from '~/stores/explorer';
import DatePicker from './DatePicker.vue';

/** A range to show instead of the store's, e.g. while the slider is dragged. */
const props = defineProps<{ live?: string | null }>();

const uniqueId = useId();
const range = useStore($dateRange);

const open = ref(false);
const view = ref<'presets' | 'custom'>('presets');
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const place = ref<Record<'top' | 'bottom' | 'left' | 'width' | 'maxHeight', string> | null>(null);

function position() {
  const anchor = (root.value?.offsetParent as HTMLElement | null) ?? root.value;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const px = (value: number) => `${Math.round(value)}px`;
  // Flipped, the panel ends just above the range label, covering the slider.
  const triggerRect = trigger.value?.getBoundingClientRect() ?? rect;
  const below = innerHeight - rect.bottom - 12;
  const above = triggerRect.top - 12;
  // Open below the slider, or over it when a short window leaves more room there.
  const down = below >= 320 || below >= above;
  place.value = {
    top: down ? px(rect.bottom + 4) : 'auto',
    bottom: down ? 'auto' : px(innerHeight - triggerRect.top + 4),
    left: px(rect.left),
    width: px(rect.width),
    maxHeight: px(down ? below : above),
  };
}

const UNITS: { id: DateUnit; label: string }[] = [
  { id: 'y', label: 'Years' },
  { id: 'm', label: 'Months' },
  { id: 'd', label: 'Days' },
];
const EXAMPLE: Record<DateUnit, string> = { y: '2020', m: 'Mar 2020', d: '12 Mar 2020' };

/* The custom range being edited; only Apply writes it to the store. */
const unit = ref<DateUnit>('y');
const from = ref<string | null>(null);
const to = ref<string | null>(null);
const active = ref<'from' | 'to'>('from');
/** Where the calendar shows: moves only when an end is chosen, not after each pick. */
const at = ref<string | null>(null);
function edit(end: 'from' | 'to') {
  active.value = end;
  at.value = (end === 'from' ? from.value : to.value) ?? from.value ?? to.value;
}

/* What the From and To boxes show; typed text is read on Enter or blur. */
const show = (iso: string | null) => (iso ? formatDate(iso, unit.value) : '');
const fromText = ref('');
const toText = ref('');
const typeError = ref('');
let errorTimer: ReturnType<typeof setTimeout> | undefined;
const syncText = () => {
  fromText.value = show(from.value);
  toText.value = show(to.value);
};
watch([from, to, unit], syncText);

function commitText(end: 'from' | 'to') {
  const text = end === 'from' ? fromText.value : toText.value;
  const key = text.trim() ? parseDateInput(text) : '';
  if (key === null) {
    typeError.value = `Try a date like ${EXAMPLE[unit.value]}.`;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => (typeError.value = ''), 3000);
    return;
  }
  typeError.value = '';
  // A coarser date than the unit covers all of it ("2020" in Days: 1 Jan to 31 Dec).
  const parsedUnit = key && keyUnit(key);
  if (end === 'from') from.value = key ? startOf(startOf(key, parsedUnit as DateUnit), unit.value) : null;
  else to.value = key ? endOf(endOf(key, parsedUnit as DateUnit), unit.value) : null;
  if (from.value && to.value && from.value > to.value)
    [from.value, to.value] = [startOf(to.value, unit.value), endOf(from.value, unit.value)];
  syncText();
  edit(end);
}

function loadDraft() {
  const current = range.value;
  if (!current) [unit.value, from.value, to.value] = ['y', null, null];
  else if ('preset' in current) {
    const resolved = resolveRange(current);
    [unit.value, from.value, to.value] = ['d', resolved.from, resolved.to];
  } else [unit.value, from.value, to.value] = [current.unit, current.from, current.to];
  typeError.value = '';
  syncText();
  edit('from');
}
// The slider writes the same store: keep an open custom range in step.
watch(range, () => {
  if (open.value && view.value === 'custom') loadDraft();
});

const isPreset = (preset: Preset) => !!range.value && 'preset' in range.value && range.value.preset === preset;
const isCustom = computed(() => !!range.value && !('preset' in range.value));
const label = computed(() => props.live ?? (range.value ? rangeLabel(range.value) : 'Any time'));

function toggle() {
  open.value = !open.value;
  view.value = isCustom.value ? 'custom' : 'presets';
  if (view.value === 'custom') loadDraft();
}
function close(refocus = true) {
  open.value = false;
  if (refocus) void nextTick(() => trigger.value?.focus());
}
function choose(preset: Preset | null) {
  $dateRange.set(preset && { preset: preset });
  close();
}
function showCustom() {
  loadDraft();
  view.value = 'custom';
}

function setUnit(nextUnit: DateUnit) {
  unit.value = nextUnit;
  // Round each end out to the new unit.
  if (from.value) from.value = startOf(from.value, nextUnit);
  if (to.value) to.value = endOf(to.value, nextUnit);
}
function pick(key: string) {
  typeError.value = '';
  if (active.value === 'from') {
    from.value = startOf(key, unit.value);
    if (to.value && to.value < from.value) to.value = null;
    active.value = 'to';
  } else {
    const end = endOf(key, unit.value);
    if (from.value && end < from.value) from.value = startOf(key, unit.value);
    else to.value = end;
  }
}
function apply() {
  $dateRange.set(from.value || to.value ? { unit: unit.value, from: from.value, to: to.value } : null);
  close();
}

function onOutside(event: PointerEvent) {
  const target = event.target as Node;
  if (!root.value?.contains(target) && !panel.value?.contains(target)) close(false);
}
function listen(on: boolean) {
  const callback = on ? addEventListener : removeEventListener;
  callback('pointerdown', onOutside as EventListener);
  // Follow the slider when the flyout scrolls or the window resizes.
  callback('scroll', position, true);
  callback('resize', position);
}
watch(open, (isOpen) => {
  if (isOpen) position();
  listen(isOpen);
});
onBeforeUnmount(() => {
  listen(false);
  clearTimeout(errorTimer);
});
</script>

<template>
  <div ref="root" class="when-menu" @keydown.esc.stop="close()">
    <button
      ref="trigger"
      type="button"
      class="trigger"
      :aria-expanded="open"
      :aria-controls="`${uniqueId}-menu`"
      aria-haspopup="true"
      :aria-label="`Date range: ${label}`"
      @click="toggle"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16" />
      </svg>
      <span class="whitespace-nowrap" aria-live="polite">{{ label }}</span>
      <svg
        viewBox="0 0 24 24"
        class="chevron size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-if="open && place"
        :id="`${uniqueId}-menu`"
        ref="panel"
        class="panel"
        :style="place"
        @keydown.esc.stop="close()"
      >
        <ul v-if="view === 'presets'" aria-label="Date range">
          <li>
            <button type="button" class="item" :aria-pressed="!range" @click="choose(null)">
              Any time <span v-if="!range" class="selected">Selected</span>
            </button>
          </li>
          <li v-for="(text, presetKey) in PRESETS" :key="presetKey">
            <button type="button" class="item" :aria-pressed="isPreset(presetKey)" @click="choose(presetKey)">
              {{ text }} <span v-if="isPreset(presetKey)" class="selected">Selected</span>
            </button>
          </li>
          <li class="divider">
            <button type="button" class="item" :aria-pressed="isCustom" @click="showCustom">
              Custom range
              <span v-if="isCustom" class="selected">Selected</span>
              <svg
                v-else
                viewBox="0 0 24 24"
                class="size-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </li>
        </ul>

        <div v-else>
          <button type="button" class="back" @click="view = 'presets'">
            <svg
              viewBox="0 0 24 24"
              class="size-4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m15 6-6 6 6 6" />
            </svg>
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
                  @change="setUnit(unitOption.id)"
                />
                {{ unitOption.label }}
              </label>
            </fieldset>

            <div class="ends">
              <label class="end" :class="{ active: active === 'from' }">
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
              <label class="end" :class="{ active: active === 'to' }">
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

            <DatePicker :unit="unit" :from="from" :to="to" :at="at" @pick="pick" />

            <div class="footer">
              <button type="button" class="link" :disabled="!from && !to" @click="from = to = null">Clear</button>
              <span class="flex gap-1">
                <button type="button" class="btn" @click="close()">Cancel</button>
                <button type="button" class="btn primary" @click="apply">Apply</button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.when-menu {
  flex-shrink: 0;
}
/* A bordered pill with a calendar, so it reads as a dropdown before hover. */
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-weight: 500;
  color: var(--text);
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}
.trigger:hover,
.trigger[aria-expanded='true'] {
  border-color: var(--border-strong);
  background: var(--surface-3);
}
.trigger svg {
  color: var(--text-muted);
}
.trigger[aria-expanded='true'] .chevron {
  transform: rotate(180deg);
}
.panel {
  position: fixed;
  z-index: 50;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-shadow: var(--shadow);
  padding: 0.25rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  font-weight: 400;
  white-space: normal;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 1.625rem;
  padding: 0 0.375rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  text-align: left;
}
.item:hover {
  color: var(--text);
  background: var(--surface-2);
}
.item[aria-pressed='true'] {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.selected {
  font-size: 0.6875rem;
  color: var(--accent);
}
.divider {
  /* Custom range stays in view when a short window makes the list scroll. */
  position: sticky;
  bottom: -0.25rem;
  margin: 0.125rem -0.25rem -0.25rem;
  padding: 0.125rem 0.25rem 0.25rem;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
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
  outline: 2px solid var(--focus);
  outline-offset: 1px;
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
  .item,
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
