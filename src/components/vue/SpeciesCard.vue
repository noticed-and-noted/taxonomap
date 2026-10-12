<script setup lang="ts">
/**
 * Photo card: edge-to-edge image (GBIF thumbnail), common name first,
 * scientific name in italic serif, record count, licence + creator badge.
 */
import { computed, ref } from 'vue';
import { compact } from '~/lib/format';
import type { UsableImage } from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import ThumbImage from './ThumbImage.vue';

const props = defineProps<{
  speciesKey: number;
  scientificName: string;
  commonName?: string | undefined;
  count?: number | undefined;
  image?: UsableImage | undefined;
  /** Width class for the thumbnail request. */
  size?: '200x' | '400x';
  selected?: boolean;
}>();

const emit = defineEmits<{ select: [key: number] }>();

const broken = ref(false);
const initials = computed(() =>
  (props.commonName ?? props.scientificName)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join(''),
);
</script>

<template>
  <article
    class="species-card group overflow-hidden rounded-md border bg-surface-2 transition-colors duration-200"
    :class="selected ? 'border-accent' : 'border-transparent hover:border-border-strong'"
  >
    <button type="button" class="block w-full text-left" :aria-pressed="selected" @click="emit('select', speciesKey)">
      <span class="relative block aspect-[4/3] overflow-hidden bg-photo">
        <ThumbImage
          v-if="image && !broken"
          :image="image"
          :size="size ?? '400x'"
          :alt="commonName ? `${commonName} (${scientificName})` : scientificName"
          class="size-full object-cover"
          @broken="broken = true"
        />
        <span v-else class="grid size-full place-items-center font-display text-2xl text-subtle" aria-hidden="true">
          {{ initials }}
        </span>
      </span>
      <span class="block px-2.5 pb-2 pt-1.5">
        <span v-if="commonName" class="block truncate text-sm font-medium text-text">{{ commonName }}</span>
        <span class="sci-name block truncate text-xs text-muted">{{ scientificName }}</span>
        <span v-if="count !== undefined" class="mt-0.5 block text-[11px] text-subtle"
          >{{ compact(count) }} records</span
        >
      </span>
    </button>
    <span v-if="image" class="block px-2.5 pb-2">
      <LicenceBadge :licence="image.licence" :creator="image.creator" :rights-holder="image.rightsHolder" />
    </span>
  </article>
</template>
