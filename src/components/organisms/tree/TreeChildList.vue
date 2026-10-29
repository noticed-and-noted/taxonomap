<script setup lang="ts">
/**
 * The focused group's sub-groups, biggest first by the chosen metric, with a filter by name.
 * It is the tree's keyboard path and its data-table fallback.
 */
import { computed, ref, watch } from 'vue';
import SearchInput from '~/components/molecules/SearchInput.vue';
import { useScrollFade } from '~/composables/useScrollFade';
import { normalise } from '~/lib/data/name-index';
import { compact } from '~/lib/format';
import type { TreeNode } from '~/lib/tree/model';

const props = defineProps<{
  focus: TreeNode;
  /** The focus's children, sorted. */
  children: readonly TreeNode[];
  metric: 'records' | 'species';
  selectedKey: number | null;
  /** The group whose own children are loading. */
  loadingKey: number | null;
}>();
const emit = defineEmits<{ pick: [node: TreeNode] }>();

const groupQuery = ref('');
const list = ref<HTMLElement>();
const { fadeTop, fadeBottom, update: updateFade } = useScrollFade(list);

const metricOf = (node: TreeNode) => (props.metric === 'records' ? node.records : node.species);
const visibleChildren = computed(() => {
  const needle = normalise(groupQuery.value);
  if (!needle) return props.children;
  return props.children.filter((child) => normalise(`${child.common ?? ''} ${child.name}`).includes(needle));
});

// A filter typed for one group means nothing in the next.
watch(
  () => props.focus,
  () => (groupQuery.value = ''),
);
watch(visibleChildren, updateFade, { flush: 'post' });
</script>

<template>
  <div class="flex flex-col md:min-h-0 md:flex-1">
    <h3 class="mb-1.5 text-sm font-medium">
      <template v-if="visibleChildren.length !== children.length">{{ visibleChildren.length }} of </template>
      {{ children.length }} {{ children.length === 1 ? 'group' : 'groups' }} in {{ focus.common ?? focus.name }}
    </h3>
    <div v-if="children.length > 1" class="mb-2">
      <SearchInput v-model="groupQuery" placeholder="Filter groups" aria-label="Filter groups" />
    </div>
    <!-- Padding gives the rows' focus ring room inside the scroll box. -->
    <ol
      ref="list"
      class="fade-list -mx-1 max-h-[50dvh] space-y-0.5 overflow-y-auto p-1 text-sm md:max-h-none md:min-h-0 md:flex-1"
      :class="{ 'fade-top': fadeTop, 'fade-bottom': fadeBottom }"
      @scroll.passive="updateFade"
    >
      <li v-for="child in visibleChildren" :key="child.key">
        <button
          type="button"
          class="grid min-h-11 w-full grid-cols-[1fr_auto] items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2 md:min-h-0"
          :aria-current="selectedKey === child.key ? 'true' : undefined"
          :class="{ 'bg-accent-soft': selectedKey === child.key }"
          @click="emit('pick', child)"
        >
          <span class="min-w-0 truncate">
            {{ child.common ?? child.name }}
            <span v-if="child.common" class="sci-name text-xs text-subtle">{{ child.name }}</span>
            <span v-if="loadingKey === child.key" class="text-xs text-subtle"> · loading…</span>
          </span>
          <span class="text-xs tabular-nums text-muted">{{ compact(metricOf(child)) }}</span>
        </button>
      </li>
    </ol>
    <p v-if="!children.length" class="text-xs text-subtle">No sub-groups with records.</p>
    <p v-else-if="!visibleChildren.length" class="text-xs text-subtle">
      No groups match “{{ groupQuery }}”.
      <button type="button" class="text-text underline" @click="groupQuery = ''">Clear filter</button>
    </p>
  </div>
</template>
