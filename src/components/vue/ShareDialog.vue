<script setup lang="ts">
/**
 * Share card: drawn on a canvas, shared with the Web Share API (as an image
 * file where supported), otherwise downloaded, or the link copied.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { canvasToBlob, drawShareCard, type DrawToken } from '~/lib/near/share-card';
import type { ClassGroup } from '~/lib/near/data';

const props = defineProps<{
  open: boolean;
  lat: number;
  lng: number;
  radiusKm: number;
  month?: string | undefined;
  groups: readonly (ClassGroup & { species: number; topNames: string[] })[];
  totalSpecies: number;
  allTopNames: string[];
}>();
const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement>();
const canvas = ref<HTMLCanvasElement>();
const groupKey = ref<number | 0>(0);
const status = ref('');
const busy = ref(false);

const group = computed(() => props.groups.find((g) => g.key === groupKey.value));
const label = (g: ClassGroup) => (g.common ?? g.name).toLowerCase();

watch(
  () => props.open,
  async (o) => {
    if (o) {
      const birds = props.groups.find((g) => g.key === 212);
      groupKey.value = birds?.key ?? 0;
      dialog.value?.showModal();
      await nextTick();
      void redraw();
    } else dialog.value?.close();
  },
);

watch(groupKey, () => void redraw());

// Tallies arrive after the dialog opens: default to birds once known.
watch(
  () => props.groups,
  (gs) => {
    if (!props.open) return;
    const birds = gs.find((g) => g.key === 212);
    if (groupKey.value === 0 && birds) groupKey.value = birds.key;
    else void redraw();
  },
);

let token: DrawToken = { cancelled: false };

async function redraw() {
  if (!canvas.value) return;
  token.cancelled = true;
  const mine: DrawToken = { cancelled: false };
  token = mine;
  busy.value = true;
  const g = group.value;
  await document.fonts?.ready;
  await drawShareCard(
    canvas.value,
    {
      count: g ? g.species : props.totalSpecies,
      groupLabel: g ? `${label(g)} species` : 'species',
      radiusKm: props.radiusKm,
      lat: props.lat,
      lng: props.lng,
      topNames: g ? g.topNames : props.allTopNames,
      month: props.month,
      theme: document.documentElement.dataset['theme'] === 'light' ? 'light' : 'dark',
      taxonKey: g?.key,
    },
    mine,
  );
  if (!mine.cancelled) busy.value = false;
}

const shareText = computed(() => {
  const g = group.value;
  const n = g ? g.species : props.totalSpecies;
  return `${n} ${g ? `${label(g)} ` : ''}species recorded within ${props.radiusKm} km${props.month ? ` in ${props.month}` : ''} — explore on Taxonomap`;
});

async function share() {
  status.value = '';
  const blob = canvas.value ? await canvasToBlob(canvas.value) : null;
  const url = window.location.href;
  try {
    if (blob && 'canShare' in navigator) {
      const file = new File([blob], 'near-me.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'What’s near me', text: shareText.value, url });
        return;
      }
    }
    if ('share' in navigator) {
      await navigator.share({ title: 'What’s near me', text: shareText.value, url });
      return;
    }
    download(blob);
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') download(blob);
  }
}

function download(blob: Blob | null) {
  if (!blob) {
    status.value = 'The image could not be created in this browser. Copy the link instead.';
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'near-me.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  status.value = 'Image downloaded.';
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    status.value = 'Link copied.';
  } catch {
    status.value = 'Copying is blocked in this browser; copy the address bar instead.';
  }
}

function onCancel(e: Event) {
  e.preventDefault();
  emit('close');
}
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(44rem,94vw)] rounded-lg border border-border bg-surface p-0 text-text shadow-panel backdrop:bg-black/70"
    aria-labelledby="share-h"
    @cancel="onCancel"
  >
    <div class="space-y-4 p-5">
      <div class="flex items-center justify-between gap-3">
        <h2 id="share-h" class="font-display text-xl">Share what’s near</h2>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-muted hover:bg-surface-2"
          aria-label="Close"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <canvas
        ref="canvas"
        class="aspect-[1200/630] w-full rounded-md border border-border"
        :class="{ 'opacity-60': busy }"
        role="img"
        :aria-label="shareText"
      ></canvas>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label class="flex items-center gap-2">
          <span class="text-muted">Group</span>
          <select v-model="groupKey" class="rounded-md border border-border bg-surface px-2 py-1">
            <option :value="0">All species ({{ totalSpecies }})</option>
            <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.common ?? g.name }} ({{ g.species }})</option>
          </select>
        </label>
        <span class="ml-auto flex gap-2">
          <button
            type="button"
            class="rounded-md border border-border px-3 py-1.5 hover:border-accent"
            @click="copyLink"
          >
            Copy link
          </button>
          <button
            type="button"
            class="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-contrast"
            @click="share"
          >
            Share image
          </button>
        </span>
      </div>
      <p class="text-xs text-subtle" aria-live="polite">
        {{
          status ||
          'The card shows the area on a map but does not print your coordinates. The link contains the location rounded to about 100 m.'
        }}
      </p>
    </div>
  </dialog>
</template>
