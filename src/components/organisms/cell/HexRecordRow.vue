<script setup lang="ts">
/**
 * One record's row in the cell's record list: photo, name, type code and date. Clicking it
 * toggles the details row below. Expanded, the photo moves into the details and the name
 * takes its column.
 */
import type { StyleValue } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import type { Occurrence, UsableImage } from '~/lib/gbif';
import { initials } from '~/lib/format';
import { recordDate, recordScientificName, typeCode, typeLabel } from '~/lib/record-fields';

defineProps<{
  occurrence: Occurrence;
  isExpanded: boolean;
  /** The id of the details row this row's button controls. */
  detailsId: string;
  /** The record's first photo that hasn't failed to load. */
  photo?: UsableImage | undefined;
  /** Whether the photo has loaded at some size, so its skeleton can go. */
  isPhotoLoaded: boolean;
  /** The species' common name, when known; the scientific name shows beneath it. */
  commonName?: string | undefined;
  /** The record's display name: its common name, else its scientific name. */
  name: string;
  /** View-transition names for the photo and name while the row opens or closes. */
  photoStyle?: StyleValue | undefined;
  nameStyle?: StyleValue | undefined;
}>();
const emit = defineEmits<{
  toggle: [];
  'photo-loaded': [photo: UsableImage];
  'photo-broken': [photo: UsableImage];
}>();
</script>

<template>
  <tr
    :data-record="occurrence.key"
    class="record cursor-pointer border-b border-border hover:bg-surface-2"
    :data-type="occurrence.basisOfRecord"
    @click="emit('toggle')"
  >
    <td v-if="!isExpanded" class="py-1.5 pl-4 pr-2">
      <span class="relative block size-8 overflow-hidden rounded bg-photo" :style="photoStyle">
        <template v-if="photo">
          <SkeletonBlock v-if="!isPhotoLoaded" class="absolute inset-0" height="100%" rounded="sm" aria-hidden="true" />
          <ThumbImage
            :image="photo"
            size="200x"
            class="relative size-full object-cover"
            @loaded="emit('photo-loaded', photo)"
            @broken="emit('photo-broken', photo)"
          />
        </template>
        <span v-else class="grid size-full place-items-center font-display text-xs text-subtle">
          {{ initials(name) }}
        </span>
      </span>
    </td>
    <td :colspan="isExpanded ? 2 : 1" class="py-1.5 pr-2" :class="{ 'pl-4': isExpanded }">
      <!-- Two lines' height (h-9) so the row doesn't grow when a common name arrives. -->
      <button
        type="button"
        class="flex h-9 w-full min-w-0 cursor-pointer items-center text-left"
        :aria-expanded="isExpanded"
        :aria-controls="detailsId"
        @click.stop="emit('toggle')"
      >
        <span class="inline-block max-w-full align-top" :style="nameStyle">
          <span class="block truncate" :class="{ 'sci-name': !commonName }">{{ name }}</span>
          <span
            v-if="commonName && recordScientificName(occurrence)"
            class="sci-name block truncate text-xs text-muted"
            >{{ recordScientificName(occurrence) }}</span
          >
        </span>
      </button>
    </td>
    <td class="py-1.5">
      <span class="type-code" tabindex="0" :data-tip="typeLabel(occurrence)" :aria-label="typeLabel(occurrence)">{{
        typeCode(occurrence)
      }}</span>
    </td>
    <td class="truncate py-1.5 pr-4 text-xs tabular-nums">{{ recordDate(occurrence) ?? '—' }}</td>
  </tr>
</template>

<style scoped>
/* The open row's details already mark which record has focus, so its name needs no ring as well. */
.record button[aria-expanded='true']:focus-visible {
  outline: none;
}
/* Type colours: ≥4.5:1 on the code's tint in each theme. */
.record {
  --type: var(--text-muted);
}
.record[data-type='HUMAN_OBSERVATION'] {
  --type: #5dcaa5;
}
.record[data-type='FOSSIL_SPECIMEN'] {
  --type: #f0997b;
}
.record[data-type='PRESERVED_SPECIMEN'],
.record[data-type='LIVING_SPECIMEN'] {
  --type: #afa9ec;
}
.record[data-type='MACHINE_OBSERVATION'] {
  --type: #b4b2a9;
}
.record[data-type='MATERIAL_SAMPLE'],
.record[data-type='MATERIAL_CITATION'] {
  --type: #85b7eb;
}
:root[data-theme='light'] .record[data-type='HUMAN_OBSERVATION'] {
  --type: #0f6e56;
}
:root[data-theme='light'] .record[data-type='FOSSIL_SPECIMEN'] {
  --type: #993c1d;
}
:root[data-theme='light'] .record[data-type='PRESERVED_SPECIMEN'],
:root[data-theme='light'] .record[data-type='LIVING_SPECIMEN'] {
  --type: #534ab7;
}
:root[data-theme='light'] .record[data-type='MACHINE_OBSERVATION'] {
  --type: #5f5e5a;
}
:root[data-theme='light'] .record[data-type='MATERIAL_SAMPLE'],
:root[data-theme='light'] .record[data-type='MATERIAL_CITATION'] {
  --type: #185fa5;
}
.type-code {
  position: relative;
  display: inline-block;
  padding: 0.0625rem 0.25rem;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--type);
  background: color-mix(in srgb, var(--type) 16%, transparent);
}
/* Tooltip to the left, so the scroll box never clips it above or below. Hover devices only: on touch
   it is never seen, and its hidden box sits over the list's scroll surface. */
@media (hover: hover) {
  .type-code::after {
    content: attr(data-tip);
    position: absolute;
    right: calc(100% + 0.375rem);
    top: 50%;
    translate: 0 -50%;
    z-index: 2;
    padding: 0.125rem 0.375rem;
    border-radius: var(--radius-sm);
    background: var(--text);
    color: var(--bg);
    font-weight: 400;
    letter-spacing: 0;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms;
  }
  .type-code:hover::after,
  .type-code:focus-visible::after {
    opacity: 1;
  }
}
</style>
