<script setup lang="ts">
/** The selected (or focused) group in the tree: its photo, names, counts, share of its parent, and links. */
import { useStore } from '@nanostores/vue';
import { computed } from 'vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { full, RANK_LABELS } from '~/lib/format';
import type { UsableImage } from '~/lib/gbif';
import { $speciesManifest, speciesPath } from '~/lib/species/links';
import type { TreeNode } from '~/lib/tree/model';

const props = defineProps<{
  node: TreeNode;
  /** The group's lead photo, once found. */
  photo: UsableImage | null;
  /** From the pick until the photo has drawn (or there turns out to be none). */
  isPhotoLoading: boolean;
  /** The node's share of its parent, 0 to 1, by the chosen metric. */
  share: number;
}>();
const emit = defineEmits<{ 'photo-settled': [] }>();

const manifest = useStore($speciesManifest);
const aboutHref = computed(() => speciesPath(props.node.key, manifest.value));
</script>

<template>
  <div class="flex gap-3">
    <div class="relative size-20 shrink-0 overflow-hidden rounded-md bg-photo">
      <SkeletonBlock v-if="isPhotoLoading" height="100%" class="absolute inset-0" label="Loading photo" />
      <ThumbImage
        v-if="photo"
        :key="photo.url"
        :image="photo"
        size="200x"
        class="relative size-full object-cover"
        @loaded="emit('photo-settled')"
        @broken="emit('photo-settled')"
      />
      <img
        v-else-if="node.rank === 'ROOT'"
        src="/images/blue-marble.webp"
        alt=""
        title="The Blue Marble, Apollo 17 (NASA, public domain)"
        class="size-full object-cover"
      />
    </div>
    <div class="min-w-0">
      <p class="text-[0.6875rem] uppercase tracking-wide text-subtle">
        {{ RANK_LABELS[node.rank] ?? 'All life' }}
      </p>
      <h2 class="truncate font-display text-xl leading-tight">{{ node.common ?? node.name }}</h2>
      <p v-if="node.common" class="sci-name truncate text-sm text-muted">{{ node.name }}</p>
      <p class="mt-1 text-xs text-muted">
        {{ full(node.records) }} records · {{ full(node.species) }} species
        <span v-if="node.parent && node.parent.rank !== 'ROOT'">
          · {{ (share * 100).toFixed(1) }}% of {{ node.parent.common ?? node.parent.name }}</span
        >
      </p>
    </div>
  </div>
  <div v-if="node.rank !== 'ROOT'" class="flex flex-wrap gap-2 text-xs">
    <a :href="`/?taxon=${node.key}`" class="rounded-md bg-accent px-2.5 py-1.5 font-medium text-accent-contrast"
      >View on map</a
    >
    <a :href="aboutHref" class="rounded-md border border-border px-2.5 py-1.5 hover:border-accent">About page</a>
    <a
      :href="`https://www.gbif.org/species/${node.key}`"
      target="_blank"
      rel="noopener"
      class="rounded-md border border-border px-2.5 py-1.5 hover:border-accent"
      >GBIF <UiIcon name="external"
    /></a>
  </div>
</template>
