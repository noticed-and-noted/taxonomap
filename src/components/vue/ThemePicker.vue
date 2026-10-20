<script setup lang="ts">
/** Dark/light picker for the phone Filters sheet (the header toggle is hidden there). Styled as BasemapSwitcher. */
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import type { Theme } from '~/lib/basemaps';
import { currentTheme, setTheme } from '~/lib/theme';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const current = ref(currentTheme());
const group = `theme-${useId()}`;
const sync = () => (current.value = currentTheme());

onMounted(() => document.addEventListener('themechange', sync));
onBeforeUnmount(() => document.removeEventListener('themechange', sync));
</script>

<template>
  <fieldset class="flex w-fit rounded-md border border-border bg-surface p-0.5 shadow-panel">
    <legend class="sr-only">Theme</legend>
    <label
      v-for="theme in THEMES"
      :key="theme.id"
      class="cursor-pointer rounded-sm px-2.5 py-2 text-xs sm:py-1 text-muted transition-colors duration-200 has-[:checked]:bg-accent has-[:checked]:text-accent-contrast has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] hover:text-text"
    >
      <input
        type="radio"
        :name="group"
        class="sr-only"
        :value="theme.id"
        :checked="current === theme.id"
        @change="setTheme(theme.id)"
      />
      {{ theme.label }}
    </label>
  </fieldset>
</template>
