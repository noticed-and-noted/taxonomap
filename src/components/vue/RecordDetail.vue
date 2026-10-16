<script setup lang="ts">
/**
 * A single occurrence record with full attribution: dataset, publisher and
 * record licence. Fetched on click (three cached requests).
 */
import { computed, ref, watch } from 'vue';
import { nameIndexWithin } from '~/lib/data/name-index';
import { BASIS_LABELS } from '~/lib/format';
import {
  classifyError,
  getDataset,
  getOccurrence,
  getOrganization,
  parseLicence,
  usableImages,
  type Dataset,
  type Occurrence,
  type Organization,
  type UiErrorKind,
} from '~/lib/gbif';
import LicenceBadge from './LicenceBadge.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';

const props = defineProps<{ occurrenceKey: number }>();
const emit = defineEmits<{ back: [] }>();

const occ = ref<Occurrence | null>(null);
const dataset = ref<Dataset | null>(null);
const org = ref<Organization | null>(null);
const commonName = ref<string | null>(null);
const error = ref<UiErrorKind | null>(null);
const loading = ref(true);

async function load(key: number) {
  loading.value = true;
  error.value = null;
  occ.value = null;
  dataset.value = null;
  org.value = null;
  try {
    const o = await getOccurrence(key);
    occ.value = o;
    const [d, idx] = await Promise.all([getDataset(o.datasetKey).catch(() => null), nameIndexWithin()]);
    dataset.value = d;
    const sk = o.speciesKey ?? o.taxonKey;
    commonName.value = (sk !== undefined && idx?.get(sk)?.commonName) || null;
    const orgKey = o.publishingOrgKey ?? d?.publishingOrganizationKey;
    if (orgKey) org.value = await getOrganization(orgKey).catch(() => null);
  } catch (e) {
    error.value = classifyError(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.occurrenceKey,
  (k) => void load(k),
  { immediate: true },
);

const images = computed(() => (occ.value ? usableImages(occ.value) : []));
const licence = computed(() => parseLicence(occ.value?.license) ?? occ.value?.license ?? 'Unknown licence');
const date = computed(() => {
  const o = occ.value;
  if (!o) return null;
  if (o.eventDate) return o.eventDate.slice(0, 10);
  return o.year ? [o.year, o.month, o.day].filter(Boolean).join('-') : null;
});
</script>

<template>
  <div class="record-detail text-sm">
    <button
      type="button"
      class="mb-3 text-xs text-muted underline-offset-2 hover:text-text hover:underline"
      @click="emit('back')"
    >
      ← Back to cell summary
    </button>

    <div v-if="loading" class="space-y-2">
      <SkeletonBlock height="1.25rem" width="60%" />
      <SkeletonBlock height="0.9rem" width="40%" />
      <SkeletonBlock height="8rem" />
    </div>

    <p v-else-if="error" class="rounded-md bg-surface-2 p-3 text-muted">
      {{
        error === 'not-found'
          ? 'This record is no longer available on GBIF.'
          : 'This record could not be loaded right now.'
      }}
      <button v-if="error !== 'not-found'" type="button" class="ml-1 underline" @click="load(occurrenceKey)">
        Try again
      </button>
    </p>

    <template v-else-if="occ">
      <h3 class="font-display text-lg leading-tight">
        {{ commonName ?? occ.vernacularName ?? occ.species ?? occ.scientificName }}
      </h3>
      <p class="sci-name text-muted">{{ occ.acceptedScientificName ?? occ.scientificName }}</p>

      <div v-if="images.length" class="-mx-4 mt-3 flex snap-x gap-1 overflow-x-auto px-4">
        <figure
          v-for="img in images.slice(0, 6)"
          :key="img.url"
          class="relative shrink-0 snap-start overflow-hidden rounded-md bg-photo"
        >
          <ThumbImage :image="img" size="400x" class="h-40 w-auto object-cover" />
          <figcaption class="absolute bottom-1 left-1 right-1">
            <LicenceBadge :licence="img.licence" :creator="img.creator" :rights-holder="img.rightsHolder" />
          </figcaption>
        </figure>
      </div>

      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <template v-if="date"
          ><dt class="text-subtle">Date</dt>
          <dd>{{ date }}</dd></template
        >
        <template v-if="occ.locality || occ.country">
          <dt class="text-subtle">Place</dt>
          <dd>{{ [occ.locality, occ.country].filter(Boolean).join(', ') }}</dd>
        </template>
        <template v-if="occ.basisOfRecord"
          ><dt class="text-subtle">Type</dt>
          <dd>{{ BASIS_LABELS[occ.basisOfRecord] ?? occ.basisOfRecord }}</dd></template
        >
        <template v-if="occ.coordinateUncertaintyInMeters">
          <dt class="text-subtle">Precision</dt>
          <dd>± {{ Math.round(occ.coordinateUncertaintyInMeters) }} m</dd>
        </template>
      </dl>

      <section class="mt-4 rounded-md border border-border p-3 text-xs" aria-label="Attribution">
        <p>
          <span class="mr-1 text-subtle">Dataset:</span>
          <a
            :href="`https://www.gbif.org/dataset/${occ.datasetKey}`"
            target="_blank"
            rel="noopener"
            class="underline-offset-2 hover:underline"
            >{{ dataset?.title ?? occ.datasetKey }}</a
          >
        </p>
        <p v-if="org" class="mt-1"><span class="mr-1 text-subtle">Publisher:</span> {{ org.title }}</p>
        <p class="mt-1"><span class="mr-1 text-subtle">Record licence:</span> {{ licence }}</p>
        <p class="mt-2">
          <a
            :href="`https://www.gbif.org/occurrence/${occ.key}`"
            target="_blank"
            rel="noopener"
            class="text-accent underline-offset-2 hover:underline"
            >View record on GBIF.org ↗</a
          >
        </p>
      </section>
    </template>
  </div>
</template>
