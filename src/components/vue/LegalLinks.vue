<script setup lang="ts">
/** Links to the privacy notice and the terms and credits; static, so it renders without hydrating. */
const LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms and credits' },
];
</script>

<template>
  <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
    <li v-for="link in LINKS" :key="link.href">
      <a :href="link.href" class="legal-link">{{ link.label }}</a>
    </li>
  </ul>
</template>

<style scoped>
.legal-link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  transition: color var(--dur-fast) var(--ease);
}

.legal-link:hover {
  color: var(--text);
}

@media (min-width: 640px) {
  .legal-link {
    min-height: 1.5rem;
  }
}
</style>
