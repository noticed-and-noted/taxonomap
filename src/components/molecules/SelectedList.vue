<script lang="ts">
/** Past this many rows, the list scrolls instead of growing. */
export const SCROLL_AFTER = 5;
</script>

<script setup lang="ts" generic="Item extends { key: string | number }">
/**
 * The picked values of a multi-select filter (taxa, publishers) as accent rows, each with a
 * remove button. The default slot fills a row; past SCROLL_AFTER rows the list scrolls with
 * edge fades, and a newly added row is brought into view.
 */
import { nextTick, ref, watch } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { useScrollFade } from '~/composables/useScrollFade';

const props = defineProps<{
  items: readonly Item[];
  /** Accessible name for the list, e.g. "Selected taxa". */
  label: string;
  removeLabel: (item: Item) => string;
}>();

defineSlots<{ default(slotProps: { item: Item }): unknown }>();

const emit = defineEmits<{ remove: [key: Item['key']] }>();

const list = ref<HTMLUListElement>();
const { fadeTop, fadeBottom, update: updateFade } = useScrollFade(list);
watch([() => props.items, list], () => nextTick(updateFade));

// The rows follow their keys' order, so a new one can land out of view once the list scrolls.
watch(
  () => props.items.map((item) => item.key),
  async (next, previous) => {
    const added = next.find((key) => !previous.includes(key));
    if (added === undefined) return;
    await nextTick();
    list.value?.querySelector(`[data-key="${added}"]`)?.scrollIntoView({ block: 'nearest' });
  },
);
</script>

<template>
  <ul
    ref="list"
    class="selected-list fade-list space-y-1"
    :class="{ scrolls: items.length > SCROLL_AFTER, 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
    :aria-label="`${label} (${items.length})`"
    @scroll.passive="updateFade"
  >
    <li v-for="item in items" :key="item.key" :data-key="item.key" class="selected-row">
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <slot :item="item" />
      </span>
      <button type="button" class="remove-btn" :aria-label="removeLabel(item)" @click="emit('remove', item.key)">
        <UiIcon name="close" size="0.875rem" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
/* About five and a half rows (2rem each, 0.25rem apart): the cut-off row shows there is more. */
.selected-list.scrolls {
  max-height: 12.25rem;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.selected-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  padding: 0 0.25rem 0 0.625rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}

.remove-btn {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  font-size: 1rem;
  line-height: 1;
  color: var(--text-muted);
}
.remove-btn:hover {
  color: var(--text);
  background: var(--surface-3);
}
</style>
