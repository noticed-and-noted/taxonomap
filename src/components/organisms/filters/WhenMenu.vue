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
import UiIcon from '~/components/atoms/UiIcon.vue';
import { rangeLabel, type DateRange, type Preset } from '~/lib/dates';
import { $dateRange } from '~/stores/explorer';
import WhenMenuCustomRange from './WhenMenuCustomRange.vue';
import WhenMenuPresets from './WhenMenuPresets.vue';

/** Room kept between the panel and the window's edge, in px. */
const EDGE_MARGIN = 12;
/** Gap between the panel and the slider or label it hangs from, in px. */
const PANEL_GAP = 4;
/** Below the slider gets at least this much room before the panel flips above it, in px. */
const MIN_ROOM_BELOW = 320;

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

const isCustom = computed(() => !!range.value && !('preset' in range.value));
const label = computed(() => props.live ?? (range.value ? rangeLabel(range.value) : 'Any time'));

/** Places the panel under the slider, or over it when a short window leaves more room there. */
function position() {
  const anchor = (root.value?.offsetParent as HTMLElement | null) ?? root.value;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const px = (value: number) => `${Math.round(value)}px`;
  // Flipped, the panel ends just above the range label, covering the slider.
  const triggerRect = trigger.value?.getBoundingClientRect() ?? rect;
  const below = innerHeight - rect.bottom - EDGE_MARGIN;
  const above = triggerRect.top - EDGE_MARGIN;
  const isBelow = below >= MIN_ROOM_BELOW || below >= above;
  place.value = {
    top: isBelow ? px(rect.bottom + PANEL_GAP) : 'auto',
    bottom: isBelow ? 'auto' : px(innerHeight - triggerRect.top + PANEL_GAP),
    left: px(rect.left),
    width: px(rect.width),
    maxHeight: px(isBelow ? below : above),
  };
}

/** Opens or closes the menu, on the custom range when that's what's set. */
function toggle() {
  open.value = !open.value;
  view.value = isCustom.value ? 'custom' : 'presets';
}

/** Closes the menu, returning focus to its button unless the user clicked elsewhere. */
function close(refocus = true) {
  open.value = false;
  if (refocus) void nextTick(() => trigger.value?.focus());
}

/** Stores a preset (or any time) and closes. */
function choose(preset: Preset | null) {
  $dateRange.set(preset && { preset: preset });
  close();
}

/** Stores the custom range and closes. */
function apply(customRange: DateRange | null) {
  $dateRange.set(customRange);
  close();
}

/** Closes the menu when a press lands outside it and its button. */
function onOutside(event: PointerEvent) {
  const target = event.target as Node;
  if (!root.value?.contains(target) && !panel.value?.contains(target)) close(false);
}

/** Starts or stops the listeners an open menu needs. */
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
onBeforeUnmount(() => listen(false));
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
      <UiIcon name="calendar" size="0.875rem" />
      <span class="whitespace-nowrap" aria-live="polite">{{ label }}</span>
      <UiIcon name="chevron-down" size="0.875rem" class="chevron" />
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
        <WhenMenuPresets v-if="view === 'presets'" :range="range" @choose="choose" @custom="view = 'custom'" />
        <WhenMenuCustomRange v-else :range="range" @apply="apply" @cancel="close()" @back="view = 'presets'" />
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
</style>
