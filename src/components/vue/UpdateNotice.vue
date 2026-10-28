<script setup lang="ts">
/**
 * "A new version is available" note with a Reload button, shown once a new
 * deploy's service worker is waiting.
 */
import { useStore } from '@nanostores/vue';
import { $applyUpdate } from '~/stores/app-update';
import Notice from './Notice.vue';

const applyUpdate = useStore($applyUpdate);
</script>

<template>
  <Notice action="Reload" @act="applyUpdate?.()">A new version of Taxonomap is available.</Notice>
</template>
