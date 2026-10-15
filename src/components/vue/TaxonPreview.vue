<script setup lang="ts">
/**
 * Preview of the highlighted header-search result: photo, rank, record count
 * and up to two actions (add/select if offered, and its About page, for any rank). Data loads after a short
 * pause on a result, so arrowing through the list stays cheap; both requests
 * go through the cached client.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { compact, RANK_LABELS } from '~/lib/format';
import { occurrenceFacets, type NameHit, type UsableImage } from '~/lib/gbif';
import { leadPhoto } from '~/lib/photos/taxon-photos';
import { debounce } from '~/lib/util/debounce';
import ThumbImage from './ThumbImage.vue';

const props = defineProps<{ hit: NameHit; href: string; aboutLabel: string; selectLabel?: string | undefined }>();
const emit = defineEmits<{ select: []; about: [] }>();

const image = ref<UsableImage>();
const liveCount = ref<number | null>(null);
const imageLoading = ref(false);
let seq = 0;

const count = computed(() => props.hit.count ?? liveCount.value);
const name = computed(() => props.hit.commonName ?? props.hit.scientificName);

const load = debounce(async (hit: NameHit) => {
  const mine = ++seq;
  imageLoading.value = true;
  const [img, total] = await Promise.allSettled([
    leadPhoto({ key: hit.key, rank: hit.rank }),
    // The baked index knows counts; live suggestions need one cheap count request.
    hit.count === undefined ? occurrenceFacets({ taxonKey: hit.key }, []) : Promise.resolve(null),
  ]);
  if (mine !== seq) return;
  image.value = img.status === 'fulfilled' ? img.value : undefined;
  liveCount.value = total.status === 'fulfilled' && total.value ? total.value.count : null;
  imageLoading.value = false;
}, 200);

watch(
  () => props.hit.key,
  () => {
    seq++;
    image.value = undefined;
    liveCount.value = null;
    imageLoading.value = true;
    load(props.hit);
  },
  { immediate: true },
);

onBeforeUnmount(() => load.cancel());
</script>

<template>
  <section class="taxon-preview" :aria-label="`Preview: ${name}`">
    <div class="thumb">
      <ThumbImage v-if="image" :key="image.url" :image="image" size="200x" alt="" class="size-full object-cover" />
      <span v-else-if="!imageLoading" class="text-xs text-subtle">No photo</span>
    </div>
    <div class="body">
      <p class="truncate font-medium text-text">{{ name }}</p>
      <p v-if="hit.commonName" class="sci-name truncate text-xs text-muted">{{ hit.scientificName }}</p>
      <p class="mt-0.5 text-[11px] text-subtle">
        {{ RANK_LABELS[hit.rank] ?? hit.rank
        }}<span v-if="count !== null" class="tabular-nums"> · {{ compact(count) }} records</span>
      </p>
      <div class="actions">
        <button v-if="selectLabel" type="button" class="action" @mousedown.prevent @click="emit('select')">
          {{ selectLabel }}
        </button>
        <a :href="href" class="action primary" @click="emit('about')">{{ aboutLabel }}</a>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Phones: a compact row under the results. sm+: a card beside them. */
.taxon-preview {
  display: flex;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
}
.thumb {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 3.5rem;
  height: 3.5rem;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--photo-placeholder);
}
.body {
  min-width: 0;
  flex: 1;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.5rem;
}
.action {
  display: inline-flex;
  align-items: center;
  height: 1.75rem;
  padding: 0 0.625rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.75rem;
  white-space: nowrap;
}
.action:hover {
  border-color: var(--border-strong);
  background: var(--surface-2);
}
.action.primary {
  border-color: var(--accent);
  background: var(--accent-soft);
}

@media (min-width: 640px) {
  .taxon-preview {
    flex-direction: column;
    gap: 0.5rem;
    border-top: 0;
    border-left: 1px solid var(--border);
  }
  .thumb {
    width: 100%;
    height: 7.5rem;
  }
}
</style>
