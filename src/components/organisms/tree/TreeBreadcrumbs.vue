<script setup lang="ts">
/** The path from the root to the tree's focus; each step moves the tree back there. */
import type { TreeNode } from '~/lib/tree/model';

defineProps<{ crumbs: readonly TreeNode[] }>();
const emit = defineEmits<{ go: [node: TreeNode] }>();
</script>

<template>
  <nav aria-label="Tree position" class="text-xs">
    <ol class="flex flex-wrap items-center gap-1">
      <li v-for="(crumb, index) in crumbs" :key="crumb.key" class="flex items-center gap-1">
        <button
          type="button"
          class="rounded px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-text"
          :aria-current="index === crumbs.length - 1 ? 'location' : undefined"
          @click="emit('go', crumb)"
        >
          {{ crumb.common ?? crumb.name }}
        </button>
        <span v-if="index < crumbs.length - 1" class="text-subtle" aria-hidden="true">›</span>
      </li>
    </ol>
  </nav>
</template>
