<script setup lang="ts">
/**
 * Note shown when GBIF's density tiles fail: the basemap still draws, so the
 * map stays usable without them.
 */
import GbifStatusLink from '~/components/atoms/GbifStatusLink.vue';
import Notice from '~/components/atoms/Notice.vue';
</script>

<template>
  <Notice>Occurrence tiles are unavailable right now. The basemap still works. <GbifStatusLink /></Notice>
</template>
