<script setup lang="ts">
/**
 * Preview of the highlighted header-search result: photo, rank, record count
 * and up to two actions (add/select if offered, and its About page, for any rank). Data loads after a short
 * pause on a result, so arrowing through the list stays cheap, and moving to another result cancels
 * what the last one was still asking for. Requests go through the cached client.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import NameSkeleton from '~/components/atoms/NameSkeleton.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import { compact, RANK_LABELS } from '~/lib/format';
import { occurrenceFacets, type NameHit, type UsableImage } from '~/lib/gbif';
import { usesStaticNameSearch } from '~/lib/name-search/format';
import { bakedPreview } from '~/lib/name-search/preview';
import { rememberInatMatches } from '~/lib/photos/inat-ids';
import { leadPhotos } from '~/lib/photos/taxon-photos';
import { debounce } from '~/lib/util/debounce';

/** Pause on a result before asking for its data. */
const LOAD_DELAY_MS = 300;

const props = defineProps<{
  hit: NameHit;
  /** The reader moved to this row, rather than typing having highlighted it. */
  isRowChosen: boolean;
  href: string;
  aboutLabel: string;
  /** Picking the result in place: full label for screen readers, short caption beside or under the icon. */
  select?: { label: string; caption: string; icon: 'filter' | 'tree' } | undefined;
}>();
const emit = defineEmits<{ select: []; about: [] }>();

const image = ref<UsableImage>();
const liveCount = ref<number | null>(null);
const imageLoading = ref(false);
/** A live lookup waiting for the reader to choose the row: under static search, typing alone reaches no API. */
const isHeldBack = ref(false);
/** The photo file itself has loaded; until then the thumb shimmers. */
const imageShown = ref(false);
let controller: AbortController | undefined;

const count = computed(() => props.hit.count ?? liveCount.value);
/** Only live suggestions wait for a count; `imageLoading` covers both requests, so a failed count stops shimmering too. */
const isCountLoading = computed(
  () => !usesStaticNameSearch() && props.hit.count === undefined && liveCount.value === null && imageLoading.value,
);
const name = computed(() =>
  props.hit.isNamePending ? props.hit.scientificName : (props.hit.commonName ?? props.hit.scientificName),
);

/** Asks the APIs for a hit's photo and, when `isCountNeeded`, its record count. */
async function loadLive(hit: NameHit, signal: AbortSignal, isCountNeeded: boolean) {
  const lead = await leadPhotos([{ key: hit.key, rank: hit.rank }], { signal, withCounts: isCountNeeded }).catch(
    () => null,
  );
  if (signal.aborted) return;
  image.value = lead?.images.get(hit.key);
  liveCount.value = lead?.counts.get(hit.key) ?? null;
  if (isCountNeeded && liveCount.value === null) liveCount.value = await countOf(hit, signal);
}

/** The live lookup, unless static search holds it back until the reader chooses the row. */
async function loadLiveOnceChosen(hit: NameHit, signal: AbortSignal, isCountNeeded: boolean) {
  isHeldBack.value = usesStaticNameSearch() && !props.isRowChosen;
  if (!isHeldBack.value) await loadLive(hit, signal, isCountNeeded);
}

/**
 * The static-search preview: a baked photo costs no API request, and a taxon with no row shows "No
 * photo" without asking. A row without a photo has its lead photo in a most-voted observation, so
 * it goes through the live path, told the known ID so the GBIF search is skipped.
 */
async function loadBaked(hit: NameHit, signal: AbortSignal) {
  const preview = await bakedPreview(hit);
  if (signal.aborted) return;
  if (preview.state === 'photo') image.value = preview.image;
  if (preview.state !== 'live') return;
  if (preview.inatId) rememberInatMatches(new Map([[hit.key, { id: preview.inatId }]]));
  await loadLiveOnceChosen(hit, signal, false);
}

const load = debounce(async (hit: NameHit) => {
  const { signal } = (controller = new AbortController());
  imageLoading.value = true;
  // The baked index knows counts; a live suggestion's rides along with its photo search.
  if (usesStaticNameSearch()) await loadBaked(hit, signal);
  else await loadLiveOnceChosen(hit, signal, hit.count === undefined);
  if (signal.aborted) return;
  imageLoading.value = false;
}, LOAD_DELAY_MS);

/** A taxon's record count when the photo search didn't bring it (an iNaturalist photo was found), or null. */
async function countOf(hit: NameHit, signal: AbortSignal): Promise<number | null> {
  const total = await occurrenceFacets({ taxonKey: hit.key }, [], { signal }).catch(() => null);
  return total?.count ?? null;
}

/** Starts afresh for the current hit. */
function restart() {
  controller?.abort();
  image.value = undefined;
  imageShown.value = false;
  liveCount.value = null;
  isHeldBack.value = false;
  imageLoading.value = true;
  load(props.hit);
}

watch(() => props.hit.key, restart, { immediate: true });
watch(
  () => props.isRowChosen,
  (isChosen) => {
    if (isChosen && isHeldBack.value) restart();
  },
);

onBeforeUnmount(() => {
  load.cancel();
  controller?.abort();
});
</script>

<template>
  <section class="taxon-preview" :aria-label="`Preview: ${name}`">
    <div class="thumb">
      <SkeletonBlock
        v-if="imageLoading || (image && !imageShown)"
        class="absolute inset-0"
        height="100%"
        rounded="sm"
        aria-hidden="true"
      />
      <ThumbImage
        v-if="image"
        :key="image.url"
        :image="image"
        size="200x"
        alt=""
        class="relative size-full object-cover"
        @loaded="imageShown = true"
        @broken="image = undefined"
      />
      <span v-else-if="!imageLoading && !isHeldBack" class="text-xs text-subtle">No photo</span>
    </div>
    <div class="body">
      <p v-if="hit.isNamePending"><NameSkeleton /></p>
      <p v-else class="truncate font-medium text-text">{{ name }}</p>
      <p v-if="hit.commonName" class="sci-name truncate text-xs text-muted">{{ hit.scientificName }}</p>
      <p class="mt-0.5 text-[0.6875rem] text-subtle">
        {{ RANK_LABELS[hit.rank] ?? hit.rank
        }}<span v-if="count !== null" class="tabular-nums"> · {{ compact(count) }} records</span
        ><span v-else-if="isCountLoading" class="ml-1 inline-flex items-center gap-1 align-middle"
          ><span aria-hidden="true">·</span><SkeletonBlock width="4.5rem" height="0.6rem" label="Loading record count"
        /></span>
      </p>
    </div>
    <div class="actions">
      <button
        v-if="select"
        type="button"
        class="action select"
        :aria-label="select.label"
        @mousedown.prevent
        @click="emit('select')"
      >
        <span class="action-icon"><UiIcon :name="select.icon" size="18" /></span>
        <span class="action-caption" aria-hidden="true">{{ select.caption }}</span>
      </button>
      <a :href="href" class="action about-link" @mousedown.prevent @click="emit('about')">
        <span class="action-icon primary"><UiIcon name="info" size="18" /></span>
        <span class="action-caption" aria-hidden="true">{{ aboutLabel }}</span>
        <span class="sr-only">{{ aboutLabel }} {{ name }}</span>
      </a>
    </div>
  </section>
</template>

<style scoped>
/* Phones: a compact row under the results. sm+: a card beside them. */
.taxon-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
}
.thumb {
  position: relative;
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
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 0.5rem;
}
/* Icon over a short caption, like the filter rail. */
.action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1875rem;
  min-width: 2.75rem;
  color: var(--text);
}
.action-icon {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}
.action-icon.primary {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.select:hover .action-icon {
  border-color: var(--border-strong);
  background: var(--surface-2);
}
/* A deeper accent tint, so About still reads as the main action on hover. */
.about-link:hover .action-icon.primary {
  background: color-mix(in srgb, var(--accent) 28%, var(--surface));
}
.action-caption {
  font-size: 0.6875rem;
  line-height: 1;
  color: var(--text-muted);
}
@media (min-width: 640px) {
  .taxon-preview {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    border-top: 0;
    border-left: 1px solid var(--border);
  }
  .thumb {
    width: 100%;
    height: 7.5rem;
  }
  /* Room for words here: bordered buttons with an icon and the caption. */
  .actions {
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 0.375rem;
  }
  .action {
    flex-direction: row;
    gap: 0.375rem;
    min-width: 0;
    height: 1.75rem;
    padding: 0 0.625rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition:
      border-color var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }
  .action-icon,
  .action-icon.primary,
  .select:hover .action-icon,
  .about-link:hover .action-icon.primary {
    width: auto;
    height: auto;
    border: 0;
    background: none;
  }
  .action-icon svg {
    width: 1rem;
    height: 1rem;
  }
  .about-link {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .select:hover {
    border-color: var(--border-strong);
    background: var(--surface-2);
  }
  .about-link:hover {
    background: color-mix(in srgb, var(--accent) 28%, var(--surface));
  }
  .action-caption {
    font-size: 0.75rem;
    color: var(--text);
  }
}
</style>
