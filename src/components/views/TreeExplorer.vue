<script setup lang="ts">
/**
 * Tree of life browser (client:only). Baked kingdom→order levels, live
 * lazy-loading below; sunburst or icicle (icicle by default on narrow
 * screens); records vs species sizing. In cube mode the record counts come
 * from the cubes (lib/tree/model.ts), and a banner says so.
 * Selecting a node only moves the tree; it leaves the shared taxon filter
 * alone ("view on map" applies it). The child list is the keyboard path and data-table fallback.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import SegmentedControl from '~/components/atoms/SegmentedControl.vue';
import CubeDemoBanner from '~/components/molecules/CubeDemoBanner.vue';
import SkeletonBlock from '~/components/atoms/SkeletonBlock.vue';
import TreeBreadcrumbs from '~/components/organisms/tree/TreeBreadcrumbs.vue';
import TreeChart from '~/components/organisms/tree/TreeChart.vue';
import TreeChildList from '~/components/organisms/tree/TreeChildList.vue';
import TreeNodeDetails from '~/components/organisms/tree/TreeNodeDetails.vue';
import TreeSkeleton from '~/components/organisms/tree/TreeSkeleton.vue';
import { RANK_BY_CODE } from '~/lib/data/ranks';
import { compact, RANK_LABELS } from '~/lib/format';
import { classifyError, type UiErrorKind, type UsableImage } from '~/lib/gbif';
import { leadPhoto } from '~/lib/photos/taxon-photos';
import { loadSpeciesManifest } from '~/lib/species/links';
import {
  findNode,
  isExpandable,
  loadBakedTree,
  loadChildren,
  pathTo,
  resolve,
  ROOT_KEY,
  type TreeNode,
} from '~/lib/tree/model';
import { $taxonKey } from '~/stores/explorer';
import { $treeFocus, $treeLayout, $treeMetric } from '~/stores/tree';

const focusKey = useStore($treeFocus);
const layoutPref = useStore($treeLayout);
const storedMetric = useStore($treeMetric);
const taxonKey = useStore($taxonKey);

const root = shallowRef<TreeNode | null>(null);
const focus = shallowRef<TreeNode | null>(null);
const selected = shallowRef<TreeNode | null>(null);
const version = ref(0);
const loadingKey = ref<number | null>(null);
const error = ref<UiErrorKind | 'no-data' | null>(null);
const photo = shallowRef<UsableImage | null>(null);
/** From the click until the photo has drawn (or there turns out to be none): shows the skeleton. */
const isPhotoLoading = ref(false);
const narrow = ref(false);
let mediaQuery: MediaQueryList | undefined;

const METRIC_OPTIONS = [
  { value: 'records', label: 'Records' },
  { value: 'species', label: 'Species' },
] as const;
const LAYOUT_OPTIONS = [
  { value: 'sunburst', label: 'Sunburst' },
  { value: 'icicle', label: 'Icicle' },
] as const;
/** Narrow screens get the icicle unless the viewer chose a layout. */
const NARROW_QUERY = '(max-width: 639.98px)';

/** The chosen layout, or the screen's default; choosing one stores it. */
const layout = computed({
  get: () => (layoutPref.value === 'auto' ? (narrow.value ? 'icicle' : 'sunburst') : layoutPref.value),
  set: (nextLayout: 'sunburst' | 'icicle') => $treeLayout.set(nextLayout),
});
const metric = computed({
  get: () => storedMetric.value,
  set: (nextMetric: 'records' | 'species') => $treeMetric.set(nextMetric),
});
const crumbs = computed(() => (focus.value ? pathTo(focus.value) : []));
const detail = computed(() => selected.value ?? focus.value);
const children = computed(() => {
  void version.value;
  return [...(focus.value?.children ?? [])].sort((left, right) => metricOf(right) - metricOf(left));
});
const metricOf = (node: TreeNode) => (metric.value === 'records' ? node.records : node.species);

/** Loads the baked tree and moves to the focus in the URL. */
async function build() {
  error.value = null;
  const fresh = await loadBakedTree();
  if (!fresh) {
    error.value = 'no-data';
    return;
  }
  root.value = fresh;
  version.value++;
  await syncFocus();
}

/** Bring the view in line with ?focus= (and ?taxon= on first load). */
async function syncFocus() {
  const rootNode = root.value;
  if (!rootNode) return;
  const wanted = focusKey.value ?? (taxonKey.value && !focus.value ? taxonKey.value : null);
  if (wanted === null || wanted === ROOT_KEY) {
    focus.value = rootNode;
    return;
  }
  loadingKey.value = wanted;
  try {
    const node = await resolve(rootNode, wanted);
    version.value++;
    if (!node) {
      focus.value = rootNode;
      return;
    }
    if (isExpandable(node)) {
      if (!node.loaded) await loadChildren(node);
      version.value++;
      focus.value = node.children?.length ? node : (node.parent ?? rootNode);
    } else {
      focus.value = node.parent ?? rootNode;
    }
    if (node.key === taxonKey.value || node.key === focusKey.value) selected.value = node;
  } catch (failure) {
    error.value = classifyError(failure);
  } finally {
    loadingKey.value = null;
  }
}

/** Selects a node, and moves the tree into it when it has sub-groups (loading them first). */
async function pick(node: TreeNode) {
  selected.value = node;
  if (!isExpandable(node)) return;
  if (!node.loaded) {
    loadingKey.value = node.key;
    try {
      await loadChildren(node);
      version.value++;
    } catch (failure) {
      error.value = classifyError(failure);
      return;
    } finally {
      loadingKey.value = null;
    }
  }
  if (node.children?.length) {
    focus.value = node;
    $treeFocus.set(node.key);
  }
}

/** Moves the tree up to the focus's parent. */
function up() {
  const parentNode = focus.value?.parent;
  if (!parentNode) return;
  focus.value = parentNode;
  $treeFocus.set(parentNode.key === ROOT_KEY ? null : parentNode.key);
}

/** Moves the tree to a breadcrumb, selecting it. */
function goTo(node: TreeNode) {
  focus.value = node;
  selected.value = node.key === ROOT_KEY ? null : node;
  $treeFocus.set(node.key === ROOT_KEY ? null : node.key);
}

// Photo for the selected node: fetched on click, never on hover.
watch(selected, async (node) => {
  photo.value = null;
  isPhotoLoading.value = Boolean(node && node.rank !== 'ROOT');
  if (!node || node.rank === 'ROOT') return;
  try {
    const image = await leadPhoto({ key: node.key, rank: RANK_BY_CODE[node.rank] });
    if (selected.value !== node) return;
    photo.value = image ?? null;
    if (!image) isPhotoLoading.value = false;
  } catch {
    // The photo is decoration; without it the details still stand.
    if (selected.value === node) isPhotoLoading.value = false;
  }
});

// Back/forward, and header-search picks (which move the tree, not the filter).
watch(focusKey, (key) => {
  if (!root.value) return;
  if ((key ?? ROOT_KEY) === focus.value?.key) return;
  const known = key === null ? root.value : findNode(root.value, key);
  if (known && (known === root.value || known.children?.length)) focus.value = known;
  else void syncFocus();
});

/** Follows the screen crossing the narrow width. */
function onNarrowChange() {
  narrow.value = !!mediaQuery?.matches;
}

onMounted(() => {
  mediaQuery = window.matchMedia(NARROW_QUERY);
  narrow.value = mediaQuery.matches;
  mediaQuery.addEventListener('change', onNarrowChange);
  void loadSpeciesManifest();
  void build();
});
onBeforeUnmount(() => mediaQuery?.removeEventListener('change', onNarrowChange));

/** A node's share of its parent by the chosen metric, 0 to 1. */
const share = (node: TreeNode) => {
  const parent = node.parent;
  const total = parent
    ? metricOf(parent) || (parent.children ?? []).reduce((subtotal, child) => subtotal + metricOf(child), 0)
    : 0;
  return total ? metricOf(node) / total : 0;
};
</script>

<template>
  <section
    class="tree-explorer mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-5 md:h-full"
    aria-labelledby="tree-h"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 id="tree-h" class="font-display text-2xl">Tree of life</h1>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <SegmentedControl v-model="metric" legend="Size by" :options="METRIC_OPTIONS" />
        <SegmentedControl v-model="layout" legend="Layout" :options="LAYOUT_OPTIONS" />
      </div>
    </div>

    <CubeDemoBanner class="!mb-0" />

    <TreeBreadcrumbs :crumbs="crumbs" @go="goTo" />

    <div v-if="error && !root" class="grid flex-1 place-items-center" role="alert">
      <div class="text-center">
        <p class="text-muted">
          {{ error === 'no-data' ? 'The tree data could not be loaded.' : 'GBIF is busy right now.' }}
        </p>
        <button type="button" class="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-contrast" @click="build">
          Try again
        </button>
      </div>
    </div>

    <div
      v-else-if="!root || !focus"
      class="grid flex-1 gap-4 md:grid-cols-[1fr_22rem]"
      role="status"
      aria-label="Loading the tree"
    >
      <div class="relative h-[55dvh] min-h-[20rem] md:h-auto md:min-h-[22rem]">
        <TreeSkeleton :layout="layout" :narrow="narrow" />
      </div>
      <SkeletonBlock height="20rem" />
    </div>

    <div v-else class="grid grid-cols-[minmax(0,1fr)] gap-4 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="relative h-[55dvh] min-h-[20rem] md:h-auto md:min-h-[22rem]">
        <TreeChart
          :root="root"
          :focus="focus"
          :version="version"
          :metric="metric"
          :layout="layout"
          :selected-key="selected?.key ?? null"
          :loading-key="loadingKey"
          @pick="pick"
          @up="up"
        />
        <p
          v-if="error"
          class="absolute bottom-2 left-2 rounded-md bg-surface px-3 py-1.5 text-xs text-muted shadow-panel"
          role="status"
        >
          Some levels could not be loaded. Try again in a moment.
        </p>
      </div>

      <!-- Phones: the details panel is below the fold, so echo the selection here. -->
      <div
        v-if="detail && detail.rank !== 'ROOT'"
        class="-mt-2 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 md:hidden"
        aria-live="polite"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">
            {{ detail.common ?? detail.name }}
            <span class="text-xs font-normal text-subtle">{{ RANK_LABELS[detail.rank] }}</span>
          </p>
          <p class="text-xs text-muted">
            {{ compact(detail.records) }} records · {{ compact(detail.species) }} species
          </p>
        </div>
        <a
          :href="`/?taxon=${detail.key}`"
          class="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-contrast"
          >View on map</a
        >
      </div>

      <aside
        class="flex flex-col gap-4 md:min-h-0 md:overflow-hidden rounded-lg border border-border bg-surface p-4"
        aria-label="Details"
      >
        <TreeNodeDetails
          v-if="detail"
          :node="detail"
          :photo="photo"
          :is-photo-loading="isPhotoLoading"
          :share="share(detail)"
          @photo-settled="isPhotoLoading = false"
        />
        <TreeChildList
          :focus="focus"
          :children="children"
          :metric="metric"
          :selected-key="selected?.key ?? null"
          :loading-key="loadingKey"
          @pick="pick"
        />
      </aside>
    </div>
  </section>
</template>
