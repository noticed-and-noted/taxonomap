<script setup lang="ts">
/** The app's version, and the commit it was built from when the build knows it (CI builds do). */
const version = import.meta.env.PUBLIC_APP_VERSION;
const buildId = import.meta.env.PUBLIC_BUILD_ID;
</script>

<template>
  <p class="text-xs text-subtle tabular-nums">
    Version {{ version }}<template v-if="buildId"> · build {{ buildId }}</template>
  </p>
</template>
