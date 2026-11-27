<script setup lang="ts">
/** A species' square photo: a skeleton while it's looked up, then the photo, or the name's initials if there's none. */
import { ref, watch } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import { initials } from '~/lib/format';
import type { UsableImage } from '~/lib/gbif';

const props = defineProps<{ image: UsableImage | undefined; pending: boolean; name: string }>();

const isBroken = ref(false);
watch(
  () => props.image,
  () => (isBroken.value = false),
);
</script>

<template>
  <span class="shrink-0 overflow-hidden rounded-sm bg-photo">
    <SkeletonBlock v-if="pending" height="100%" rounded="sm" aria-hidden="true" />
    <ThumbImage
      v-else-if="image && !isBroken"
      :image="image"
      size="200x"
      alt=""
      class="size-full object-cover"
      @broken="isBroken = true"
    />
    <span v-else class="grid size-full place-items-center font-display text-xs text-subtle" aria-hidden="true">
      {{ initials(name) }}
    </span>
  </span>
</template>
