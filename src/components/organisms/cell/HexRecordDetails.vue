<script setup lang="ts">
/**
 * An expanded record's details: its photo (opening the lightbox of all its photos), who recorded it,
 * how precise it is, who published it, its source, its sound, and links to the species and to GBIF.
 */
import { computed, ref, watch, type StyleValue } from 'vue';
import LicenceBadge from '~/components/atoms/LicenceBadge.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import ThumbImage from '~/components/atoms/ThumbImage.vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import SoundPlayer from '~/components/molecules/SoundPlayer.vue';
import { getOrganization, type Occurrence, type UsableImage } from '~/lib/gbif';
import { usableSounds } from '~/lib/gbif/licence';
import { initials } from '~/lib/format';
import { accuracy } from '~/lib/record-fields';

const props = defineProps<{
  occurrence: Occurrence;
  /** The record's photos that haven't failed to load; the first is shown. */
  photos: readonly UsableImage[];
  /** Whether the first photo has loaded at some size, so its skeleton can go. */
  isPhotoLoaded: boolean;
  /** The record's display name. */
  name: string;
  /** The species page to link to, when the record is named to a taxon. */
  aboutHref?: string | undefined;
  /** The photo's view-transition name while the row opens or closes. */
  photoStyle?: StyleValue | undefined;
}>();
const emit = defineEmits<{
  'photo-loaded': [photo: UsableImage];
  'photo-broken': [photo: UsableImage];
  enlarge: [];
}>();

const photo = computed(() => props.photos[0]);
const isObservation = computed(() => props.occurrence.basisOfRecord === 'HUMAN_OBSERVATION');
const source = computed(() => props.occurrence.datasetName ?? props.occurrence.publisher);
const sound = computed(() => usableSounds(props.occurrence)[0]);
const publisher = ref<string>();

// Records carry only the publishing organisation's key, so its name is looked up.
watch(
  () => props.occurrence.publishingOrgKey,
  async (key) => {
    publisher.value = undefined;
    if (!key) return;
    // A failed lookup just leaves the row out; the GBIF link still credits the publisher.
    const organization = await getOrganization(key).catch(() => null);
    if (key === props.occurrence.publishingOrgKey) publisher.value = organization?.title;
  },
  { immediate: true },
);
</script>

<template>
  <div class="grid grid-cols-2 items-start gap-3">
    <div class="relative aspect-square overflow-hidden rounded bg-photo" :style="photoStyle">
      <template v-if="photo">
        <!-- The row's 200x thumbnail is already cached: show it at once, and fade the sharper 400x in over it. -->
        <SkeletonBlock v-if="!isPhotoLoaded" class="absolute inset-0" height="100%" rounded="sm" aria-hidden="true" />
        <ThumbImage
          :image="photo"
          size="200x"
          class="absolute inset-0 size-full object-cover"
          @loaded="emit('photo-loaded', photo)"
        />
        <ThumbImage
          :image="photo"
          size="400x"
          class="absolute inset-0 size-full object-cover"
          @loaded="emit('photo-loaded', photo)"
          @broken="emit('photo-broken', photo)"
        />
        <!-- A sibling of the badge, not its parent: the badge holds a link. -->
        <button
          type="button"
          class="enlarge absolute inset-0 cursor-zoom-in"
          :aria-label="`Enlarge photo, 1 of ${photos.length}`"
          @click="emit('enlarge')"
        >
          <span
            class="absolute right-1 top-1 flex items-center gap-1 rounded-sm bg-black/55 px-1.5 backdrop-blur-sm py-0.5 text-[0.6875rem] text-white tabular-nums"
            aria-hidden="true"
          >
            <UiIcon name="photo" size="13" />{{ photos.length }}
          </span>
        </button>
        <LicenceBadge
          class="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)]!"
          :licence="photo.licence"
          :creator="photo.creator"
          :rights-holder="photo.rightsHolder"
        />
      </template>
      <span v-else class="grid size-full place-items-center font-display text-xl text-subtle">
        {{ initials(name) }}
      </span>
    </div>
    <!-- Stretched to the photo's height so the buttons line up with its bottom edge. -->
    <dl class="flex min-w-0 flex-col gap-1 self-stretch text-xs [overflow-wrap:anywhere]">
      <div v-if="occurrence.recordedBy">
        <dt class="text-subtle">Recorded by</dt>
        <dd>{{ occurrence.recordedBy }}</dd>
      </div>
      <div v-if="isObservation && accuracy(occurrence)">
        <dt class="text-subtle">Accuracy</dt>
        <dd>{{ accuracy(occurrence) }}</dd>
      </div>
      <div v-if="publisher">
        <dt class="text-subtle">Publisher</dt>
        <dd>{{ publisher }}</dd>
      </div>
      <div v-if="source">
        <dt class="text-subtle">Source</dt>
        <dd>{{ source }}</dd>
      </div>
      <dd class="mt-auto flex gap-1.5">
        <a
          v-if="aboutHref"
          :href="aboutHref"
          class="record-action record-action-icon"
          :aria-label="`About ${name}`"
          :title="`About ${name}`"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </a>
        <a
          :href="`https://www.gbif.org/occurrence/${occurrence.key}`"
          target="_blank"
          rel="noopener"
          class="record-action"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
          GBIF<span class="sr-only"> record (opens in a new tab)</span>
        </a>
      </dd>
    </dl>
    <SoundPlayer v-if="sound" :key="sound.url" class="col-span-2" :sound="sound" />
  </div>
</template>

<style scoped>
.record-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2rem;
  padding: 0 0.625rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text);
  transition: background-color var(--dur-fast) var(--ease);
}
.record-action-icon {
  justify-content: center;
  min-width: 2rem;
  padding: 0;
}
.record-action:hover {
  background: var(--surface-3);
}
.record-action:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.record-action svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.record-action-icon svg {
  width: 1.125rem;
  height: 1.125rem;
}
@media (max-width: 767px) {
  .record-action {
    min-height: 2.5rem;
  }
  .record-action-icon {
    min-width: 2.5rem;
  }
}
.enlarge:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>
