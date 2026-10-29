<script setup lang="ts">
/**
 * Loading stand-in for the cell's species and records lists: count line, header row and
 * photo-and-name rows in a box the loaded list's height. The default slot is each row's
 * trailing cells. With `rows`, only that many rows (for "show more").
 */
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';

defineProps<{ label: string; rows?: number; fill?: boolean }>();
</script>

<template>
  <div v-if="rows" role="status" :aria-label="label">
    <div v-for="row in rows" :key="row" class="skeleton-row" aria-hidden="true">
      <SkeletonBlock width="2rem" height="2rem" rounded="sm" class="mr-2 shrink-0" />
      <span class="flex h-9 min-w-0 flex-1 flex-col justify-center gap-1 pr-2">
        <SkeletonBlock :width="`${45 + ((row * 23) % 40)}%`" height="0.8rem" />
        <SkeletonBlock :width="`${30 + ((row * 17) % 25)}%`" height="0.65rem" />
      </span>
      <slot />
    </div>
  </div>
  <div v-else :class="fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'" role="status" :aria-label="label">
    <div class="flex h-4 items-center" aria-hidden="true"><SkeletonBlock width="6rem" height="0.7rem" /></div>
    <div :class="{ 'flex min-h-0 flex-1 flex-col': fill }" aria-hidden="true">
      <div class="head -mx-4 flex h-8 items-center px-4"><SkeletonBlock width="3.5rem" height="0.7rem" /></div>
      <div
        class="-mx-4 overflow-hidden [scrollbar-gutter:stable]"
        :class="fill ? 'min-h-48 flex-1' : 'h-[min(23rem,65dvh)]'"
      >
        <div v-for="row in 12" :key="row" class="skeleton-row">
          <SkeletonBlock width="2rem" height="2rem" rounded="sm" class="mr-2 shrink-0" />
          <span class="flex h-9 min-w-0 flex-1 flex-col justify-center gap-1 pr-2">
            <SkeletonBlock :width="`${45 + ((row * 23) % 40)}%`" height="0.8rem" />
            <SkeletonBlock :width="`${30 + ((row * 17) % 25)}%`" height="0.65rem" />
          </span>
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skeleton-row {
  display: flex;
  align-items: center;
  padding: 0.375rem 1rem;
  border-bottom: 1px solid var(--border);
}
.head {
  box-shadow: inset 0 -1px 0 var(--border-strong);
}
</style>
