<script setup lang="ts">
/**
 * Reading and display settings: text size, italics, spacing and motion,
 * plus (outside Settings, which has its own list) the map colours. Changes
 * apply to the whole page at once; the preview card shows them on a sample.
 */
import { useStore } from '@nanostores/vue';
import { useId } from 'vue';
import { RAMPS, type RampId } from '~/lib/ramp';
import { $ramp, setRamp } from '~/stores/ramp';
import { $reading, setReading, TEXT_SIZES, type ReadingPrefs } from '~/stores/reading';

/** In Settings: the map colours list sits beside it, so no dropdown or preview. */
const props = defineProps<{ inSettings?: boolean }>();

type ToggleKey = Exclude<keyof ReadingPrefs, 'textSize'>;

const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
  { key: 'noItalics', label: 'No italics', hint: 'Scientific names and quotes stay upright' },
  { key: 'wideSpacing', label: 'Wider spacing', hint: 'More room between lines, letters and words' },
  { key: 'reduceMotion', label: 'Reduce motion', hint: 'No animations or map flights' },
];

const RAMP_GROUPS = [
  { label: 'Colour-blind safe', ramps: RAMPS.filter((ramp) => 'colourBlindSafe' in ramp) },
  { label: 'Other', ramps: RAMPS.filter((ramp) => !('colourBlindSafe' in ramp)) },
];

/** The map bins use stops 1–7. */
const PREVIEW_STOPS = [1, 2, 3, 4, 5, 6, 7];

const reading = useStore($reading);
const ramp = useStore($ramp);
const id = useId();
</script>

<template>
  <div class="@container">
    <div class="grid gap-4 @lg:grid-cols-2">
      <div class="space-y-3">
        <fieldset>
          <legend class="mb-1.5 text-sm font-medium">Text size</legend>
          <div class="flex w-fit rounded-md border border-border bg-surface p-0.5">
            <label v-for="size in TEXT_SIZES" :key="size.id" class="size-option">
              <input
                type="radio"
                :name="`${id}-size`"
                class="sr-only"
                :aria-label="size.name"
                :checked="reading.textSize === size.id"
                @change="setReading({ textSize: size.id })"
              />
              <span aria-hidden="true">{{ size.label }}</span>
            </label>
          </div>
        </fieldset>

        <div>
          <label v-for="toggle in TOGGLES" :key="toggle.key" class="check-row">
            <input
              type="checkbox"
              :checked="reading[toggle.key]"
              :aria-describedby="`${id}-${toggle.key}`"
              @change="setReading({ [toggle.key]: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <span class="block text-sm">{{ toggle.label }}</span>
              <span :id="`${id}-${toggle.key}`" class="block text-xs text-muted">{{ toggle.hint }}</span>
            </span>
          </label>
        </div>

        <div v-if="!props.inSettings">
          <label :for="`${id}-ramp`" class="mb-1.5 block text-sm font-medium">Map colours</label>
          <select
            :id="`${id}-ramp`"
            class="ramp-select"
            :value="ramp"
            @change="setRamp(($event.target as HTMLSelectElement).value as RampId)"
          >
            <optgroup v-for="group in RAMP_GROUPS" :key="group.label" :label="group.label">
              <option v-for="option in group.ramps" :key="option.id" :value="option.id">{{ option.name }}</option>
            </optgroup>
          </select>
        </div>
      </div>

      <figure v-if="!props.inSettings" class="self-start rounded-lg border border-border bg-bg p-3">
        <figcaption class="mb-2 text-xs text-subtle">Preview</figcaption>
        <p class="font-display text-lg">Red fox</p>
        <p class="sci-name text-sm text-muted">Vulpes vulpes</p>
        <p class="mt-2 text-sm">Found across the northern hemisphere, from Arctic tundra to city centres.</p>
        <span class="mt-3 flex h-3 overflow-hidden rounded-sm" aria-hidden="true">
          <span
            v-for="stop in PREVIEW_STOPS"
            :key="stop"
            class="flex-1"
            :style="{ background: `var(--ramp-${stop})` }"
          ></span>
        </span>
        <span class="mt-1 flex justify-between text-xs text-subtle" aria-hidden="true">
          <span>Fewer records</span><span>More</span>
        </span>
      </figure>
    </div>
  </div>
</template>

<style scoped>
/* Positioned so the visually hidden radio sits inside its label: focusing it doesn't scroll the page. */
.size-option {
  position: relative;
  min-width: 2.75rem;
  padding: 0.5rem 0.625rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.875rem;
  text-align: center;
  transition: color var(--dur-fast) var(--ease);
}

.size-option:hover {
  color: var(--text);
}

.size-option:has(:checked) {
  background: var(--accent);
  color: var(--accent-contrast);
}

.size-option:has(:focus-visible) {
  outline: 2px solid var(--focus);
}

.check-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0 -0.5rem;
  padding: 0.5rem;
  min-height: 2.75rem;
  border-radius: var(--radius-sm);
}

.check-row:hover {
  background: var(--surface-2);
}

.check-row input {
  margin-top: 0.25rem;
  accent-color: var(--accent);
}

.ramp-select {
  width: 100%;
  height: 2.75rem;
  padding: 0 0.625rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 0.875rem;
}

.ramp-select:hover {
  border-color: var(--border-strong);
}

@media (min-width: 640px) {
  .size-option {
    padding: 0.25rem 0.625rem;
  }

  .ramp-select {
    height: 2.25rem;
  }
}
</style>
