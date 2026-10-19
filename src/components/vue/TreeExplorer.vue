<script setup lang="ts">
/**
 * Tree of life browser (client:only). Baked kingdom→order levels, live
 * lazy-loading below; sunburst or icicle (icicle by default on narrow
 * screens); records vs species sizing.
 * Selecting a node only moves the tree; it leaves the shared taxon filter
 * alone ("view on map" applies it). The child list is the keyboard path and data-table fallback.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { compact, full, RANK_LABELS } from '~/lib/format';
import { classifyError, type UiErrorKind, type UsableImage } from '~/lib/gbif';
import { RANK_BY_CODE } from '~/lib/data/ranks';
import { leadPhoto } from '~/lib/photos/taxon-photos';
import { $speciesManifest, loadSpeciesManifest, speciesPath } from '~/lib/species/links';
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
import SkeletonBlock from './SkeletonBlock.vue';
import ThumbImage from './ThumbImage.vue';
import TreeChart from './TreeChart.vue';
import UiIcon from './UiIcon.vue';

const focusKey = useStore($treeFocus);
const layoutPref = useStore($treeLayout);
const metric = useStore($treeMetric);
const taxonKey = useStore($taxonKey);
const manifest = useStore($speciesManifest);

const root = shallowRef<TreeNode | null>(null);
const focus = shallowRef<TreeNode | null>(null);
const selected = shallowRef<TreeNode | null>(null);
const version = ref(0);
const loadingKey = ref<number | null>(null);
const error = ref<UiErrorKind | 'no-data' | null>(null);
const photo = shallowRef<UsableImage | null>(null);
const narrow = ref(false);
let mq: MediaQueryList | undefined;

const layout = computed(() =>
  layoutPref.value === 'auto' ? (narrow.value ? 'icicle' : 'sunburst') : layoutPref.value,
);
const crumbs = computed(() => (focus.value ? pathTo(focus.value) : []));
const detail = computed(() => selected.value ?? focus.value);
const children = computed(() => {
  void version.value;
  return [...(focus.value?.children ?? [])].sort((a, b) => metricOf(b) - metricOf(a));
});
const metricOf = (n: TreeNode) => (metric.value === 'records' ? n.records : n.species);

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
  const r = root.value;
  if (!r) return;
  const wanted = focusKey.value ?? (taxonKey.value && !focus.value ? taxonKey.value : null);
  if (wanted === null || wanted === ROOT_KEY) {
    focus.value = r;
    return;
  }
  loadingKey.value = wanted;
  try {
    const node = await resolve(r, wanted);
    version.value++;
    if (!node) {
      focus.value = r;
      return;
    }
    if (isExpandable(node)) {
      if (!node.loaded) await loadChildren(node);
      version.value++;
      focus.value = node.children?.length ? node : (node.parent ?? r);
    } else {
      focus.value = node.parent ?? r;
    }
    if (node.key === taxonKey.value || node.key === focusKey.value) selected.value = node;
  } catch (e) {
    error.value = classifyError(e);
  } finally {
    loadingKey.value = null;
  }
}

async function pick(node: TreeNode) {
  selected.value = node;
  if (!isExpandable(node)) return;
  if (!node.loaded) {
    loadingKey.value = node.key;
    try {
      await loadChildren(node);
      version.value++;
    } catch (e) {
      error.value = classifyError(e);
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

function up() {
  const p = focus.value?.parent;
  if (!p) return;
  focus.value = p;
  $treeFocus.set(p.key === ROOT_KEY ? null : p.key);
}

function goTo(node: TreeNode) {
  focus.value = node;
  selected.value = node.key === ROOT_KEY ? null : node;
  $treeFocus.set(node.key === ROOT_KEY ? null : node.key);
}

// Photo for the selected node: fetched on click, never on hover.
watch(selected, async (n) => {
  photo.value = null;
  if (!n || n.rank === 'ROOT') return;
  try {
    const img = await leadPhoto({ key: n.key, rank: RANK_BY_CODE[n.rank] });
    if (selected.value === n) photo.value = img ?? null;
  } catch {
    /* optional */
  }
});

// Back/forward, and header-search picks (which move the tree, not the filter).
watch(focusKey, (k) => {
  if (!root.value) return;
  if ((k ?? ROOT_KEY) === focus.value?.key) return;
  const known = k === null ? root.value : findNode(root.value, k);
  if (known && (known === root.value || known.children?.length)) focus.value = known;
  else void syncFocus();
});

const setMetric = (m: 'records' | 'species') => $treeMetric.set(m);
const setLayout = (l: 'sunburst' | 'icicle') => $treeLayout.set(l);

onMounted(() => {
  mq = window.matchMedia('(max-width: 639.98px)');
  narrow.value = mq.matches;
  mq.addEventListener('change', onMq);
  void loadSpeciesManifest();
  void build();
});
onBeforeUnmount(() => mq?.removeEventListener('change', onMq));
function onMq() {
  narrow.value = !!mq?.matches;
}

const share = (n: TreeNode) => {
  const p = n.parent;
  const total = p ? metricOf(p) || (p.children ?? []).reduce((s, c) => s + metricOf(c), 0) : 0;
  return total ? metricOf(n) / total : 0;
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
        <fieldset class="seg">
          <legend class="sr-only">Size by</legend>
          <label :class="{ on: metric === 'records' }"
            ><input
              type="radio"
              class="sr-only"
              :checked="metric === 'records'"
              @change="setMetric('records')"
            />Records</label
          >
          <label :class="{ on: metric === 'species' }"
            ><input
              type="radio"
              class="sr-only"
              :checked="metric === 'species'"
              @change="setMetric('species')"
            />Species</label
          >
        </fieldset>
        <fieldset class="seg">
          <legend class="sr-only">Layout</legend>
          <label :class="{ on: layout === 'sunburst' }"
            ><input
              type="radio"
              class="sr-only"
              :checked="layout === 'sunburst'"
              @change="setLayout('sunburst')"
            />Sunburst</label
          >
          <label :class="{ on: layout === 'icicle' }"
            ><input
              type="radio"
              class="sr-only"
              :checked="layout === 'icicle'"
              @change="setLayout('icicle')"
            />Icicle</label
          >
        </fieldset>
      </div>
    </div>

    <nav aria-label="Tree position" class="text-xs">
      <ol class="flex flex-wrap items-center gap-1">
        <li v-for="(c, i) in crumbs" :key="c.key" class="flex items-center gap-1">
          <button
            type="button"
            class="rounded px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-text"
            :aria-current="i === crumbs.length - 1 ? 'location' : undefined"
            @click="goTo(c)"
          >
            {{ c.common ?? c.name }}
          </button>
          <span v-if="i < crumbs.length - 1" class="text-subtle" aria-hidden="true">›</span>
        </li>
      </ol>
    </nav>

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
      <SkeletonBlock height="100%" rounded="full" class="aspect-square max-h-[70vh]" />
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
        <div v-if="detail" class="flex gap-3">
          <div class="size-20 shrink-0 overflow-hidden rounded-md bg-photo">
            <ThumbImage v-if="photo" :key="photo.url" :image="photo" size="200x" class="size-full object-cover" />
          </div>
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-wide text-subtle">{{ RANK_LABELS[detail.rank] ?? 'All life' }}</p>
            <h2 class="truncate font-display text-xl leading-tight">{{ detail.common ?? detail.name }}</h2>
            <p v-if="detail.common" class="sci-name truncate text-sm text-muted">{{ detail.name }}</p>
            <p class="mt-1 text-xs text-muted">
              {{ full(detail.records) }} records · {{ full(detail.species) }} species
              <span v-if="detail.parent && detail.parent.rank !== 'ROOT'">
                · {{ (share(detail) * 100).toFixed(1) }}% of {{ detail.parent.common ?? detail.parent.name }}</span
              >
            </p>
          </div>
        </div>
        <div v-if="detail && detail.rank !== 'ROOT'" class="flex flex-wrap gap-2 text-xs">
          <a :href="`/?taxon=${detail.key}`" class="rounded-md bg-accent px-2.5 py-1.5 font-medium text-accent-contrast"
            >View on map</a
          >
          <a
            :href="speciesPath(detail.key, manifest)"
            class="rounded-md border border-border px-2.5 py-1.5 hover:border-accent"
            >About page</a
          >
          <a
            :href="`https://www.gbif.org/species/${detail.key}`"
            target="_blank"
            rel="noopener"
            class="rounded-md border border-border px-2.5 py-1.5 hover:border-accent"
            >GBIF <UiIcon name="external"
          /></a>
        </div>

        <div class="flex flex-col md:min-h-0 md:flex-1">
          <h3 class="mb-1.5 text-sm font-medium">
            {{ children.length }} {{ children.length === 1 ? 'group' : 'groups' }} in {{ focus.common ?? focus.name }}
          </h3>
          <ol
            class="max-h-[50dvh] space-y-0.5 overflow-y-auto overscroll-contain pr-1 text-sm md:max-h-none md:min-h-0 md:flex-1"
          >
            <li v-for="c in children" :key="c.key">
              <button
                type="button"
                class="grid min-h-11 w-full grid-cols-[1fr_auto] items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2 md:min-h-0"
                :aria-current="selected?.key === c.key ? 'true' : undefined"
                :class="{ 'bg-accent-soft': selected?.key === c.key }"
                @click="pick(c)"
              >
                <span class="min-w-0 truncate">
                  {{ c.common ?? c.name }}
                  <span v-if="c.common" class="sci-name text-xs text-subtle">{{ c.name }}</span>
                  <span v-if="loadingKey === c.key" class="text-xs text-subtle"> · loading…</span>
                </span>
                <span class="text-xs tabular-nums text-muted">{{ compact(metricOf(c)) }}</span>
              </button>
            </li>
          </ol>
          <p v-if="!children.length" class="text-xs text-subtle">No sub-groups with records.</p>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px;
  background: var(--surface);
}
.seg label {
  cursor: pointer;
  padding: 0.25rem 0.625rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.seg label.on {
  background: var(--accent);
  color: var(--accent-contrast);
}
.seg label:has(:focus-visible) {
  outline: 2px solid var(--focus);
}
</style>
