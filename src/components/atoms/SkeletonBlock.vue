<script setup lang="ts">
const ROUNDED = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', full: 'rounded-full' } as const;

withDefaults(
  defineProps<{ width?: string; height?: string; rounded?: 'sm' | 'md' | 'lg' | 'full'; label?: string }>(),
  {
    width: '100%',
    height: '1rem',
    rounded: 'md',
    label: 'Loading',
  },
);
</script>

<template>
  <span
    class="skeleton block"
    :class="ROUNDED[rounded]"
    :style="{ width, height }"
    role="status"
    :aria-label="label"
  ></span>
</template>

<style scoped>
.skeleton {
  background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s var(--ease) infinite;
}

@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
