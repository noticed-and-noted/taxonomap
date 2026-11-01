<script setup lang="ts">
/**
 * The species table's Filter button and its popover, which narrows the table to one group
 * (the parent loads that group's rows). Closes on a pick, Escape, Done or a press outside.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useScrollFade } from '~/composables/useScrollFade';
import { compact } from '~/lib/format';
import type { ClassGroup } from '~/lib/species/groups';

/** The shortest a group's bar gets, in % of the widest, so small groups still show one. */
const MIN_BAR_PERCENT = 4;

const props = defineProps<{
  groups: readonly ClassGroup[];
  /** The table's first load: the button shows but can't be used yet. */
  pending: boolean;
}>();
/** The group picked, or null for all. */
const group = defineModel<number | null>({ required: true });

const id = useId();
const isOpen = ref(false);
const button = ref<HTMLButtonElement>();
const popover = ref<HTMLElement>();
const groupList = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFade } = useScrollFade(groupList);

const canFilter = computed(() => props.groups.length > 1);
const activeFilters = computed(() => (group.value === null ? 0 : 1));
/** Groups with their share of the largest group's records. */
const groupOptions = computed(() => {
  const max = Math.max(1, ...props.groups.map((classGroup) => classGroup.records));
  return props.groups.map((classGroup) => ({ ...classGroup, bar: classGroup.records / max }));
});
const barWidth = (share: number) => `${Math.max(MIN_BAR_PERCENT, share * 100)}%`;

/** Closes the popover, returning focus to the button when closed from inside it. */
function close(refocus = false) {
  isOpen.value = false;
  if (refocus) button.value?.focus();
}

/** Applies a group, or null for all, and closes the popover. */
function pick(groupKey: number | null) {
  group.value = groupKey;
  close(true);
}

/** Closes the popover when a press lands outside it and its button. */
function onDocumentPointer(event: PointerEvent) {
  const target = event.target as Node;
  if (!popover.value?.contains(target) && !button.value?.contains(target)) close();
}

/** Escape closes the popover. */
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') close(true);
}

watch(isOpen, (open) => {
  if (open) {
    void nextTick(updateFade);
    document.addEventListener('pointerdown', onDocumentPointer);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('pointerdown', onDocumentPointer);
    document.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => (isOpen.value = false));
</script>

<template>
  <button
    v-if="canFilter || pending"
    ref="button"
    type="button"
    :disabled="pending"
    class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors duration-200 disabled:cursor-default disabled:opacity-60"
    :class="activeFilters ? 'border-accent bg-accent-soft' : 'border-border enabled:hover:border-border-strong'"
    :aria-expanded="isOpen"
    :aria-controls="`${id}-filters`"
    @click="isOpen = !isOpen"
  >
    <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
    Filter<span v-if="activeFilters" class="tabular-nums"> · {{ activeFilters }}</span>
  </button>

  <div
    v-if="isOpen && canFilter"
    :id="`${id}-filters`"
    ref="popover"
    role="dialog"
    aria-label="Filter species"
    class="absolute right-0 top-full z-20 mt-1 w-64 space-y-3 rounded-lg border border-border-strong bg-surface p-3 text-sm shadow-panel"
  >
    <!-- min-w-0: a fieldset is otherwise as wide as its longest group name. -->
    <fieldset class="min-w-0">
      <legend class="sr-only">Group</legend>
      <p class="mb-1 flex justify-between px-1.5 text-xs text-subtle" aria-hidden="true">
        <span>Group</span><span>Records</span>
      </p>
      <div
        ref="groupList"
        class="fade-list -mx-1 max-h-72 space-y-0.5 overflow-y-auto px-1"
        :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
        @scroll.passive="updateFade"
      >
        <!-- Buttons, not radios: arrowing through radios would pick, and so close, at every step. -->
        <button type="button" class="group-opt" :aria-pressed="group === null" @click="pick(null)">
          <span class="min-w-0 flex-1 truncate">All groups</span>
        </button>
        <button
          v-for="groupOption in groupOptions"
          :key="groupOption.key"
          type="button"
          class="group-opt"
          :aria-pressed="group === groupOption.key"
          @click="pick(groupOption.key)"
        >
          <span class="min-w-0 flex-1 truncate">{{ groupOption.common ?? groupOption.name }}</span>
          <span class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <span
              class="block h-full rounded-full"
              :class="group === groupOption.key ? 'bg-accent' : 'bg-border-strong'"
              :style="{ width: barWidth(groupOption.bar) }"
            ></span>
          </span>
          <span class="w-11 shrink-0 text-right text-xs tabular-nums text-muted">{{
            compact(groupOption.records)
          }}</span>
        </button>
      </div>
    </fieldset>
    <div class="flex justify-end border-t border-border pt-2 text-xs">
      <button type="button" class="font-medium" @click="close(true)">Done</button>
    </div>
  </div>
</template>

<style scoped>
.group-opt {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.25rem 0.375rem;
  border-radius: var(--radius);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.group-opt:hover {
  background: var(--surface-2);
}
.group-opt[aria-pressed='true'] {
  background: var(--accent-soft);
}
.group-opt:focus-visible {
  outline: 2px solid var(--focus);
}
</style>
