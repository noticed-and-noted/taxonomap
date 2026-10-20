<script setup lang="ts">
/**
 * Calendar grid for picking a year, month or day. The title zooms out
 * (days → months → years) to move around quickly; only cells of `unit` can be
 * picked, coarser ones drill back in. One cell is tabbable and the arrow keys
 * move it (PageUp/PageDown a page, with Shift a year), like the WAI-ARIA date
 * picker pattern.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { MONTH_NAMES, MONTHS } from '~/lib/format';
import { isoDate, KEY_LENGTH, MIN_YEAR, type DateUnit } from '~/lib/dates';

const props = defineProps<{
  unit: DateUnit;
  from: string | null;
  to: string | null;
  /** Where the grid opens (an ISO date); defaults to today. */
  at?: string | null;
}>();
const emit = defineEmits<{ pick: [key: string] }>();

const today = isoDate(new Date());
const level = ref<DateUnit>(props.unit);
const cursor = ref(toDate(props.at ?? today));
const gridEl = ref<HTMLElement>();

function toDate(iso: string): Date {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7) || 1) - 1, Number(iso.slice(8, 10) || 1));
}

watch(
  () => [props.unit, props.at] as const,
  ([unit, at]) => {
    level.value = unit;
    cursor.value = toDate(at ?? today);
  },
);

interface Cell {
  key: string;
  label: string;
  name: string;
  out: boolean;
  disabled: boolean;
}

const keyOf = (date: Date, unit: DateUnit) => isoDate(date).slice(0, KEY_LENGTH[unit]);
const cursorKey = computed(() => keyOf(cursor.value, level.value));

const cells = computed((): Cell[] => {
  const current = cursor.value;
  const currentLevel = level.value;
  const keyLength = KEY_LENGTH[currentLevel];
  const cell = (date: Date, label: string, name: string, out = false): Cell => {
    const key = keyOf(date, currentLevel);
    return { key, label, name, out, disabled: key > today.slice(0, keyLength) || date.getFullYear() < MIN_YEAR };
  };
  if (currentLevel === 'y') {
    const first = Math.floor(current.getFullYear() / 10) * 10 - 1;
    return Array.from({ length: 12 }, (_unused, index) => {
      const year = first + index;
      return cell(new Date(year, 0, 1), String(year), String(year), index === 0 || index === 11);
    });
  }
  if (currentLevel === 'm')
    return MONTHS.map((label, index) =>
      cell(new Date(current.getFullYear(), index, 1), label, `${MONTH_NAMES[index]} ${current.getFullYear()}`),
    );
  // Six Monday-first weeks around the cursor's month.
  const offset = (new Date(current.getFullYear(), current.getMonth(), 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_unused, index) => {
    const day = new Date(current.getFullYear(), current.getMonth(), 1 - offset + index);
    return cell(
      day,
      String(day.getDate()),
      `${day.getDate()} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`,
      day.getMonth() !== current.getMonth(),
    );
  });
});

const title = computed(() => {
  const current = cursor.value;
  if (level.value === 'd') return `${MONTH_NAMES[current.getMonth()]} ${current.getFullYear()}`;
  if (level.value === 'm') return String(current.getFullYear());
  const first = Math.floor(current.getFullYear() / 10) * 10;
  return `${first}–${first + 9}`;
});
const canZoomOut = computed(() => level.value !== 'y');

/** Range shading only at the picked unit. */
function state(key: string): 'end' | 'in' | null {
  if (level.value !== props.unit) return null;
  const keyLength = KEY_LENGTH[props.unit];
  const fromKey = props.from?.slice(0, keyLength);
  const toKey = props.to?.slice(0, keyLength);
  if (key === fromKey || key === toKey) return 'end';
  return fromKey && toKey && key > fromKey && key < toKey ? 'in' : null;
}

/** Move the cursor by days, months or years (month moves clamp to the month's end). */
function move(days: number, months = 0, years = 0) {
  const current = cursor.value;
  const next = new Date(current.getFullYear() + years, current.getMonth() + months, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(current.getDate(), last) + days);
  cursor.value = next;
}

/** One page back or forward: a month, a year or a decade. */
function page(dir: 1 | -1) {
  if (level.value === 'd') move(0, dir);
  else move(0, 0, level.value === 'm' ? dir : dir * 10);
}

function zoomOut() {
  level.value = level.value === 'd' ? 'm' : 'y';
}

function choose(picked: Cell) {
  if (picked.disabled) return;
  cursor.value = new Date(
    Number(picked.key.slice(0, 4)),
    Number(picked.key.slice(5, 7) || 1) - 1,
    Number(picked.key.slice(8, 10) || 1),
  );
  if (level.value === props.unit) emit('pick', picked.key);
  else level.value = level.value === 'y' ? 'm' : 'd';
}

function onKey(event: KeyboardEvent) {
  const currentLevel = level.value;
  const cols = currentLevel === 'd' ? 7 : 4;
  const step = (amount: number) =>
    currentLevel === 'd' ? move(amount) : currentLevel === 'm' ? move(0, amount) : move(0, 0, amount);
  const keys: Record<string, () => void> = {
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    ArrowUp: () => step(-cols),
    ArrowDown: () => step(cols),
    PageUp: () => (event.shiftKey ? move(0, 0, -1) : page(-1)),
    PageDown: () => (event.shiftKey ? move(0, 0, 1) : page(1)),
    Home: () => (currentLevel === 'd' ? move(-((cursor.value.getDay() + 6) % 7)) : undefined),
    End: () => (currentLevel === 'd' ? move(6 - ((cursor.value.getDay() + 6) % 7)) : undefined),
  };
  const callback = keys[event.key];
  if (!callback) return;
  event.preventDefault();
  callback();
  void nextTick(() => gridEl.value?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
}
</script>

<template>
  <div class="date-picker">
    <div class="head flex items-center justify-between">
      <button type="button" class="nav" aria-label="Previous" @click="page(-1)">
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
      </button>
      <button
        type="button"
        class="title"
        :disabled="!canZoomOut"
        :aria-label="canZoomOut ? `${title}, zoom out` : title"
        aria-live="polite"
        @click="zoomOut"
      >
        {{ title }}
        <svg
          v-if="canZoomOut"
          viewBox="0 0 24 24"
          class="size-3.5"
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
      <button type="button" class="nav" aria-label="Next" @click="page(1)">
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
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </div>
    <div ref="gridEl" class="grid" :class="level === 'd' ? 'days' : 'wide'" @keydown="onKey">
      <template v-if="level === 'd'">
        <span v-for="(initial, index) in 'MTWTFSS'" :key="index" class="weekday" aria-hidden="true">{{ initial }}</span>
      </template>
      <button
        v-for="cell in cells"
        :key="cell.key"
        type="button"
        class="cell"
        :class="[state(cell.key), { out: cell.out }]"
        :disabled="cell.disabled"
        :tabindex="cell.key === cursorKey ? 0 : -1"
        :aria-label="cell.name"
        :aria-pressed="state(cell.key) === 'end'"
        :aria-current="cell.key === today.slice(0, cell.key.length) ? 'date' : undefined"
        @click="choose(cell)"
      >
        {{ cell.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.nav,
.title {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: 1.75rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: background var(--dur-fast) var(--ease);
}
.nav {
  width: 1.75rem;
}
.nav,
.title:not(:disabled),
.cell:not(:disabled) {
  cursor: pointer;
}
.title {
  padding: 0 0.5rem;
  font-weight: 500;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.nav:hover,
.title:not(:disabled):hover,
.cell:not(:disabled):hover {
  background: var(--surface-2);
}
.grid {
  display: grid;
  gap: 0.25rem;
  margin-top: 0.25rem;
}
.days {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.wide {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
/* Rows match the cells' height so the header sits midway between the fields and the grid. */
.head {
  margin-top: 0.375rem;
}
.weekday {
  display: grid;
  place-items: center;
  height: 1.75rem;
  font-size: 0.6875rem;
  color: var(--text-subtle);
}
.cell {
  height: 1.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.cell.out {
  color: var(--text-subtle);
}
.cell:disabled {
  color: var(--text-subtle);
  opacity: 0.5;
  cursor: default;
}
.cell[aria-current='date'] {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.cell.in {
  background: var(--accent-soft);
}
.cell.end {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
@media (pointer: coarse) {
  .cell,
  .wide .cell,
  .nav,
  .title {
    height: 2.75rem;
  }
}
</style>
