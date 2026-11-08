<script setup lang="ts">
/**
 * A link to GBIF's status page, shown beside a "GBIF is busy" message so the
 * viewer can see whether GBIF itself is down.
 */
import { GBIF_STATUS_URL } from '~/lib/gbif';
</script>

<template>
  <a :href="GBIF_STATUS_URL" target="_blank" rel="noopener">GBIF status</a>
</template>

<style scoped>
/* It sits in muted message text; full text colour keeps it readable as a link. */
a {
  color: var(--text);
}
a:hover {
  color: var(--accent);
}
</style>
