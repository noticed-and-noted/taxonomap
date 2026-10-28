<script setup lang="ts">
/**
 * "GBIF is busy" note, shown when a stale cache was served. Dismissing it
 * clears the flag until the next stale response.
 */
import { $gbifStale } from '~/lib/gbif';
import Notice from './Notice.vue';

const dismiss = () => $gbifStale.set(false);
</script>

<template>
  <Notice action="Dismiss" @act="dismiss">GBIF is busy. Some data may be out of date.</Notice>
</template>
