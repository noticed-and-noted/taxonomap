<script setup lang="ts">
/** The When menu's first view: any time, the rolling presets, and the way into a custom range. */
import { computed } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { PRESETS, type DateRange, type Preset } from '~/lib/dates';

const props = defineProps<{ range: DateRange | null }>();
const emit = defineEmits<{ choose: [preset: Preset | null]; custom: [] }>();

const isPreset = (preset: Preset) => !!props.range && 'preset' in props.range && props.range.preset === preset;
const isCustom = computed(() => !!props.range && !('preset' in props.range));
</script>

<template>
  <ul aria-label="Date range">
    <li>
      <button type="button" class="item" :aria-pressed="!range" @click="emit('choose', null)">
        Any time <span v-if="!range" class="selected">Selected</span>
      </button>
    </li>
    <li v-for="(text, presetKey) in PRESETS" :key="presetKey">
      <button type="button" class="item" :aria-pressed="isPreset(presetKey)" @click="emit('choose', presetKey)">
        {{ text }} <span v-if="isPreset(presetKey)" class="selected">Selected</span>
      </button>
    </li>
    <li class="divider">
      <button type="button" class="item" :aria-pressed="isCustom" @click="emit('custom')">
        Custom range
        <span v-if="isCustom" class="selected">Selected</span>
        <UiIcon v-else name="chevron-right" size="1rem" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 1.625rem;
  padding: 0 0.375rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.8125rem;
  text-align: left;
}
.item:hover {
  color: var(--text);
  background: var(--surface-2);
}
.item[aria-pressed='true'] {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.selected {
  font-size: 0.6875rem;
  color: var(--accent);
}
.divider {
  /* Custom range stays in view when a short window makes the list scroll. */
  position: sticky;
  bottom: -0.25rem;
  margin: 0.125rem -0.25rem -0.25rem;
  padding: 0.125rem 0.25rem 0.25rem;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
@media (pointer: coarse) {
  .item {
    min-height: 2.75rem;
  }
}
</style>
