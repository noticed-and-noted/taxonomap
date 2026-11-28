<script setup lang="ts" generic="Value extends string">
/**
 * A row of mutually exclusive options drawn as one pill (visually hidden radios in labels). One highlight sits
 * behind the selected option's text and slides across to the next one picked.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

defineProps<{
  /** The group's name for screen readers. */
  legend: string;
  options: readonly { value: Value; label: string }[];
}>();
const selected = defineModel<Value>({ required: true });

const root = ref<HTMLFieldSetElement>();
/** The highlight's place, in px from the control's padding edge. */
const highlight = ref({ left: 0, width: 0 });
/** Off until the first placement, so the highlight starts under its option instead of sliding in from the edge. */
const canSlide = ref(false);

/** Puts the highlight under the selected option. */
function placeHighlight() {
  const label = root.value?.querySelector<HTMLElement>('label.on');
  if (!label) return;
  highlight.value = { left: label.offsetLeft, width: label.offsetWidth };
}

// Fonts loading or a bigger reading size change the options' widths after the first placement.
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  placeHighlight();
  requestAnimationFrame(() => (canSlide.value = true));
  resizeObserver = new ResizeObserver(placeHighlight);
  if (root.value) resizeObserver.observe(root.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
watch(selected, () => nextTick(placeHighlight));
</script>

<template>
  <fieldset ref="root" class="segmented">
    <legend class="sr-only">{{ legend }}</legend>
    <span
      class="highlight"
      :class="{ sliding: canSlide }"
      :style="{ width: `${highlight.width}px`, transform: `translateX(${highlight.left}px)` }"
      aria-hidden="true"
    ></span>
    <label v-for="option in options" :key="option.value" :class="{ on: selected === option.value }"
      ><input type="radio" class="sr-only" :checked="selected === option.value" @change="selected = option.value" />{{
        option.label
      }}</label
    >
  </fieldset>
</template>

<style scoped>
.segmented {
  position: relative;
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
  border-radius: calc(var(--radius) - 3px);
  color: var(--text-muted);
  transition: color var(--dur) var(--ease);
}
.segmented label:hover {
  color: var(--text);
}
.segmented label.on {
  color: var(--accent-contrast);
}
/* Behind the labels, inside the control, so it moves with it and never covers the text. Its corners are concentric
   with the control's: the radius less the 1px border and 2px padding. */
.highlight {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 0;
  border-radius: calc(var(--radius) - 3px);
  background: var(--accent);
}
.highlight.sliding {
  transition:
    transform var(--dur) var(--ease),
    width var(--dur) var(--ease);
}
.segmented label:has(:focus-visible) {
  outline: 2px solid var(--focus);
}
</style>
