<script setup lang="ts">
/**
 * First-visit guided tour of the map page: a welcome card, then five steps
 * that dim the page and spotlight one or two parts of it, with a tip beside
 * them. It picks the busiest hex itself so the cell panel step has something
 * to show, and clears that selection when it ends. Finishing or skipping
 * hands over to the "Try this" checklist. The dim layer takes every click,
 * so the map holds still under the spotlights.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { padBox, spotlightPath, tipPosition, type ScreenBox } from '~/lib/tour';
import {
  $busiestHexBox,
  $busiestHexRequest,
  $mapLoad,
  $panel,
  $selectedHex,
  clearHexSelection,
} from '~/stores/explorer';
import { $tourOpen, finishTour } from '~/stores/onboarding';

interface TourStep {
  title: string;
  body: string;
  /** What to spotlight; the first box anchors the tip. A step with none is skipped. */
  targets: () => (ScreenBox | null)[];
  enter?: () => void;
}

/** Frames a step's targets must hold still before it is shown (Vue starts a slide a frame after insertion). */
const STILL_FRAMES = 3;
/** Longest wait for targets to stop moving, past the slowest slide (--dur-slow). */
const SETTLE_MAX_MS = 1000;
const TIP_MAX_WIDTH = 320;
const VIEWPORT_EDGE = 16;
const WELCOME = -1;

let didSelectHex = false;
let stopWaitingForCells = () => {};
/** Bumped by each step change, so a slow settle from an earlier one gives way. */
let stepToken = 0;

/** The first matching element that is laid out (the rail and the phone Filters button share a target). */
function boxOf(selector: string): ScreenBox | null {
  for (const element of document.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return null;
}

/** Ask the map for its busiest hex; true once one is selected. */
function requestHex(): boolean {
  $busiestHexBox.set(null);
  $busiestHexRequest.set(true);
  didSelectHex = $busiestHexBox.get() !== null;
  return didSelectHex;
}

/** Select the busiest hex once (after the cells load, if they haven't); coming back keeps it, panel closed. */
function pickHex() {
  if ($panel.get() === 'hex') $panel.set('none');
  if (didSelectHex || requestHex()) return;
  stopWaitingForCells();
  stopWaitingForCells = $mapLoad.listen((load) => {
    if (load.loading || stepIndex.value !== 0) return;
    stopWaitingForCells();
    // The layer stores new cells on its next frame's draw, queued before this one.
    requestAnimationFrame(requestHex);
  });
}

const STEPS: TourStep[] = [
  {
    title: 'Every hex is a count',
    body: 'Each hex counts the records found inside it. Darker hexes hold more, and the legend shows how many, on a log scale.',
    enter: pickHex,
    targets: () => [$busiestHexBox.get(), boxOf('[data-tour="legend"]')],
  },
  {
    title: 'Inside a hex',
    body: 'Clicking a hex opens this panel: its record count, the species found there, single records, and the months they turn up.',
    enter: () => $selectedHex.get() && $panel.set('hex'),
    targets: () => [$selectedHex.get() ? boxOf('.side-panel, .bottom-sheet') : null, $busiestHexBox.get()],
  },
  {
    title: 'Search',
    body: 'Find a species, a group such as birds, or a place. Picking a species shows only its records.',
    targets: () => [boxOf('[data-tour="search"]')],
  },
  {
    title: 'Filters',
    body: 'Narrow the map by what was found, when and where, and how it was recorded.',
    targets: () => [boxOf('[data-tour="filters"]')],
  },
  {
    title: 'Beyond the map',
    body: 'Tree of life browses every group by its records. Open any species for its photos and seasons.',
    targets: () => [boxOf('[data-tour="nav"]')],
  },
];

const titleId = useId();
const card = ref<HTMLElement>();
const stepIndex = ref(WELCOME);
const boxes = ref<ScreenBox[]>([]);
/** True while a new step waits for its targets to settle; its outline and tip stay hidden meanwhile. */
const isSettling = ref(false);
/** The tip's height for this step's text, so it can be placed clear of every outline. */
const tipHeight = ref(0);
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });

const step = computed(() => STEPS[stepIndex.value]);
const isLast = computed(() => stepIndex.value === STEPS.length - 1);
const dimPath = computed(() => spotlightPath(isSettling.value ? [] : boxes.value, viewport.value));
const tipWidth = computed(() => Math.min(TIP_MAX_WIDTH, viewport.value.width - VIEWPORT_EDGE * 2));
const tipStyle = computed(() => {
  const anchor = boxes.value[0];
  if (!anchor) return {};
  const tip = { width: tipWidth.value, height: tipHeight.value };
  const position = tipPosition(anchor, viewport.value, tip, boxes.value.slice(1));
  const vertical = 'top' in position ? { top: `${position.top}px` } : { bottom: `${position.bottom}px` };
  return { width: `${tipWidth.value}px`, left: `${position.left}px`, ...vertical };
});

const px = (box: ScreenBox) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
});

function measure() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  const found = step.value?.targets() ?? [];
  boxes.value = found.filter((box): box is ScreenBox => box !== null).map(padBox);
  // Read once the tip has this step's width (the welcome card is wider), then place it again.
  void nextTick(() => (tipHeight.value = card.value?.offsetHeight ?? 0));
}

function end() {
  stepToken++;
  $busiestHexBox.set(null);
  if (didSelectHex) clearHexSelection();
  finishTour();
}

/** Waits until the step's targets hold still (the cell panel slides in), so its outline lands once. */
async function settle(): Promise<void> {
  const started = performance.now();
  let last = '';
  let stillFrames = 0;
  while (stillFrames < STILL_FRAMES && performance.now() - started < SETTLE_MAX_MS) {
    await new Promise(requestAnimationFrame);
    const current = JSON.stringify(step.value?.targets());
    stillFrames = current === last ? stillFrames + 1 : 0;
    last = current;
  }
}

async function go(index: number) {
  const direction = index > stepIndex.value ? 1 : -1;
  if (index >= STEPS.length) return end();
  const token = ++stepToken;
  isSettling.value = true;
  stepIndex.value = index;
  step.value?.enter?.();
  await nextTick();
  await settle();
  if (token !== stepToken) return;
  measure();
  isSettling.value = false;
  if (step.value && !boxes.value.length) return go(index + direction);
  card.value?.focus();
}

/** Keep Tab inside the card, and let Escape skip the tour. */
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') return end();
  if (event.key !== 'Tab' || !card.value) return;
  const buttons = [...card.value.querySelectorAll<HTMLElement>('button')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === card.value)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

// The map moves the hex's box when it resizes.
const stopFollowingHex = $busiestHexBox.listen(measure);

onMounted(() => {
  $tourOpen.set(true);
  window.addEventListener('resize', measure);
  void nextTick(() => card.value?.focus());
});

onBeforeUnmount(() => {
  stepToken++;
  stopWaitingForCells();
  stopFollowingHex();
  window.removeEventListener('resize', measure);
  $tourOpen.set(false);
});
</script>

<template>
  <Teleport to="body">
    <div
      class="tour"
      :class="{ settling: isSettling }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @keydown="onKey"
    >
      <svg class="tour-dim" :viewBox="`0 0 ${viewport.width} ${viewport.height}`" aria-hidden="true">
        <path :d="dimPath" fill-rule="evenodd" />
      </svg>
      <div v-for="(box, index) in boxes" :key="index" class="tour-ring" :style="px(box)" aria-hidden="true"></div>

      <div ref="card" tabindex="-1" class="tour-card" :class="{ centred: !boxes.length }" :style="tipStyle">
        <template v-if="!step">
          <h2 :id="titleId" class="font-display text-xl">Welcome to taxonomap</h2>
          <p class="mt-2 text-sm text-muted">
            The map is built on GBIF, the Global Biodiversity Information Facility: billions of records pooled from
            museums, herbaria, research surveys and nature apps like iNaturalist.
          </p>
          <p class="mt-2 text-sm text-muted">
            A record is one find of one organism: what it was, where, and when. It might be a museum specimen, a photo,
            or a sighting in a survey. Each hex counts the records found inside it.
          </p>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="tour-btn" @click="end">Skip</button>
            <button type="button" class="tour-btn primary" @click="go(0)">Start tour</button>
          </div>
        </template>
        <template v-else>
          <h2 :id="titleId" class="font-display text-lg">{{ step.title }}</h2>
          <p class="mt-1 text-sm text-muted">{{ step.body }}</p>
          <div class="mt-3 flex items-center gap-2">
            <span class="mr-auto text-xs text-subtle tabular-nums">{{ stepIndex + 1 }} of {{ STEPS.length }}</span>
            <button type="button" class="tour-btn quiet" @click="end">Skip</button>
            <button type="button" class="tour-btn" @click="go(stepIndex - 1)">Back</button>
            <button type="button" class="tour-btn primary" @click="go(stepIndex + 1)">
              {{ isLast ? 'Done' : 'Next' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.tour-dim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: rgb(0 0 0 / 0.5);
}

/* A step waiting for its targets to settle shows only the dim page. */
.settling .tour-ring,
.settling .tour-card {
  visibility: hidden;
}

.tour-ring {
  position: absolute;
  border: 2px solid var(--accent);
  border-radius: var(--radius);
  pointer-events: none;
}

.tour-card {
  position: absolute;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow);
  transition:
    left var(--dur) var(--ease),
    top var(--dur) var(--ease),
    bottom var(--dur) var(--ease);
}

.tour-card.centred {
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  width: min(26rem, calc(100vw - 2rem));
}

.tour-card:focus {
  outline: none;
}

.tour-btn {
  height: 2.75rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.875rem;
}

.tour-btn:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.tour-btn.quiet {
  border-color: transparent;
  color: var(--text-muted);
}

.tour-btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 500;
}

@media (min-width: 640px) {
  .tour-btn {
    height: 2.25rem;
  }
}
</style>
