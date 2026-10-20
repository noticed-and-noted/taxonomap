<script setup lang="ts">
import { computed } from 'vue';
import { LICENCE_URLS, type AllowedLicence } from '~/lib/gbif/licence';

const props = defineProps<{
  licence: AllowedLicence;
  creator?: string | undefined;
  rightsHolder?: string | undefined;
}>();

const credit = computed(() => props.creator ?? props.rightsHolder);
</script>

<template>
  <span
    class="inline-flex max-w-full items-center gap-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 text-[11px] leading-tight text-white"
  >
    <a
      :href="LICENCE_URLS[licence]"
      target="_blank"
      rel="license noopener"
      class="whitespace-nowrap font-semibold tracking-wide hover:underline"
      >{{ licence }}</a
    >
    <span v-if="credit" class="truncate">© {{ credit }}</span>
  </span>
</template>
