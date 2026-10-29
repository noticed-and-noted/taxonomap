<script setup lang="ts">
/**
 * "GBIF is busy" note, shown when a stale cache was served. Dismissing it
 * clears the flag until the next stale response.
 */
import Notice from '~/components/atoms/Notice.vue';
import { $gbifStale } from '~/lib/gbif';

const dismiss = () => $gbifStale.set(false);
</script>

<template>
  <Notice action="Dismiss" @act="dismiss">GBIF is busy. Some data may be out of date.</Notice>
</template>
