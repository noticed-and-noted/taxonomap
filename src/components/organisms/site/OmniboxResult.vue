<script setup lang="ts">
/** A species, group or place result in the header search: its names, and a taxon's rank and record count. */
import NameSkeleton from '~/components/atoms/NameSkeleton.vue';
import { compact, RANK_LABELS } from '~/lib/format';
import type { OmniboxOption } from './omniboxOptions';

defineProps<{ option: Extract<OmniboxOption, { kind: 'taxon' | 'place' }> }>();
</script>

<template>
  <template v-if="option.kind === 'taxon'">
    <span class="min-w-0 flex-1">
      <span v-if="option.hit.isNamePending" class="block"><NameSkeleton /></span>
      <span v-else-if="option.hit.commonName" class="block truncate font-medium text-text"
        >{{ option.hit.commonName }}
        <span v-if="option.hit.matchedName" class="font-normal text-muted">({{ option.hit.matchedName }})</span></span
      >
      <span class="sci-name block truncate" :class="option.hit.commonName ? 'text-xs text-muted' : 'text-text'">{{
        option.hit.scientificName
      }}</span>
    </span>
    <span class="shrink-0 text-right text-[0.6875rem] leading-tight text-subtle">
      <span class="block">{{ RANK_LABELS[option.hit.rank] ?? option.hit.rank }}</span>
      <span v-if="option.hit.count" class="block">{{ compact(option.hit.count) }}</span>
    </span>
  </template>
  <span v-else class="min-w-0 flex-1">
    <span class="block truncate text-text">{{ option.place.name }}</span>
    <span v-if="option.place.detail" class="block truncate text-xs text-muted">{{ option.place.detail }}</span>
  </span>
</template>
