<script setup lang="ts" generic="Value extends string">
/** A row of mutually exclusive options drawn as one pill (visually hidden radios in labels). */
defineProps<{
  /** The group's name for screen readers. */
  legend: string;
  options: readonly { value: Value; label: string }[];
}>();
const selected = defineModel<Value>({ required: true });
</script>

<template>
  <fieldset class="segmented">
    <legend class="sr-only">{{ legend }}</legend>
    <label v-for="option in options" :key="option.value" :class="{ on: selected === option.value }"
      ><input type="radio" class="sr-only" :checked="selected === option.value" @change="selected = option.value" />{{
        option.label
      }}</label
    >
  </fieldset>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px;
  background: var(--surface);
}
.segmented label {
  position: relative;
  cursor: pointer;
  padding: 0.25rem 0.625rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.segmented label.on {
  background: var(--accent);
  color: var(--accent-contrast);
}
.segmented label:has(:focus-visible) {
  outline: 2px solid var(--focus);
}
</style>
