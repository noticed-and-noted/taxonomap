<script setup lang="ts">
/**
 * Dims the page with an outlined hole over each target and a card beside the
 * first, for the onboarding tour and the "Try this" hints. Each time `stepKey`
 * changes it waits for the targets to hold still (the cell panel slides in),
 * then measures and reports how many it found. It measures again as the page
 * changes or resizes. Modal by default; with `clickThrough`, clicks in a hole
 * reach the page beneath, and any click outside the card dismisses it.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { padBox, spotlightPath, tipPosition, type ScreenBox } from '~/lib/tour';

const props = defineProps<{
  /** What to spotlight; the first box anchors the card. */
  targets: () => (ScreenBox | null)[];
  /** Changes with each step, so the spotlight settles and measures afresh. */
  stepKey: string | number;
  labelledby: string;
  clickThrough?: boolean;
}>();

const emit = defineEmits<{
  /** A step settled with this many targets found. */
  settled: [count: number];
  /** Escape. */
  close: [];
  /** A click outside the card (click-through only). */
  dismiss: [];
}>();

/** Frames the targets must hold still before a step is shown (Vue starts a slide a frame after insertion). */
const STILL_FRAMES = 3;
/** Longest wait for targets to stop moving, past the slowest slide (--dur-slow). */
const SETTLE_MAX_MS = 1000;
const TIP_MAX_WIDTH = 320;
const VIEWPORT_EDGE = 16;

const card = ref<HTMLElement>();
const boxes = ref<ScreenBox[]>([]);
/** True while a new step waits for its targets to settle; its outline and card stay hidden meanwhile. */
const isSettling = ref(false);
/** The card's height for this step's text, so it can be placed clear of every outline. */
const tipHeight = ref(0);
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
/** Bumped by each step change, so a slow settle from an earlier one gives way. */
let stepToken = 0;

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
  boxes.value = props
    .targets()
    .filter((box): box is ScreenBox => box !== null)
    .map(padBox);
  // Read once the card has this step's width (a centred card is wider), then place it again.
  void nextTick(() => (tipHeight.value = card.value?.offsetHeight ?? 0));
}

/** Waits until the targets hold still, so their outlines land once. */
async function settle(): Promise<void> {
  const started = performance.now();
  let last = '';
  let stillFrames = 0;
  while (stillFrames < STILL_FRAMES && performance.now() - started < SETTLE_MAX_MS) {
    await new Promise(requestAnimationFrame);
    const current = JSON.stringify(props.targets());
    stillFrames = current === last ? stillFrames + 1 : 0;
    last = current;
  }
}

async function showStep() {
  const token = ++stepToken;
  isSettling.value = true;
  await nextTick();
  await settle();
  if (token !== stepToken) return;
  measure();
  isSettling.value = false;
  emit('settled', boxes.value.length);
  card.value?.focus();
}

watch(() => props.stepKey, showStep, { immediate: true });

/** Escape closes, wherever focus is (a click-through spotlight leaves the page usable). */
function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}

/** Keeps Tab inside a modal card. */
function onKey(event: KeyboardEvent) {
  if (props.clickThrough || event.key !== 'Tab' || !card.value) return;
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

function onPointerDown(event: PointerEvent) {
  if (!card.value?.contains(event.target as Node)) emit('dismiss');
}

let isMeasureQueued = false;
/** Measure again on the next frame, once however many changes arrive (a settling step measures itself). */
function measureSoon() {
  if (isMeasureQueued || isSettling.value) return;
  isMeasureQueued = true;
  requestAnimationFrame(() => {
    isMeasureQueued = false;
    measure();
  });
}

// The cell panel fills in after it opens (its species list loads), so a target can appear mid-step.
const contentChanges = new MutationObserver(measureSoon);

onMounted(() => {
  window.addEventListener('resize', measure);
  document.addEventListener('keydown', onEscape);
  if (props.clickThrough) document.addEventListener('pointerdown', onPointerDown, true);
  const main = document.getElementById('main');
  if (main) contentChanges.observe(main, { childList: true, subtree: true });
});

onBeforeUnmount(() => {
  stepToken++;
  contentChanges.disconnect();
  window.removeEventListener('resize', measure);
  document.removeEventListener('keydown', onEscape);
  document.removeEventListener('pointerdown', onPointerDown, true);
});

defineExpose({ measure });
</script>

<template>
  <Teleport to="body">
    <div
      class="spotlight"
      :class="{ settling: isSettling, 'click-through': clickThrough }"
      role="dialog"
      :aria-modal="!clickThrough"
      :aria-labelledby="labelledby"
      @keydown="onKey"
    >
      <svg class="spotlight-dim" :viewBox="`0 0 ${viewport.width} ${viewport.height}`" aria-hidden="true">
        <path :d="dimPath" fill-rule="evenodd" />
      </svg>
      <div v-for="(box, index) in boxes" :key="index" class="spotlight-ring" :style="px(box)" aria-hidden="true"></div>

      <div ref="card" tabindex="-1" class="spotlight-card" :class="{ centred: !boxes.length }" :style="tipStyle">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.spotlight {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.spotlight-dim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: rgb(0 0 0 / 0.5);
}

/* Only the dim and the card take clicks, so the holes reach the page beneath. */
.click-through,
.click-through .spotlight-dim {
  pointer-events: none;
}

.click-through .spotlight-dim path,
.click-through .spotlight-card {
  pointer-events: auto;
}

/* A step waiting for its targets to settle shows only the dim page. */
.settling .spotlight-ring,
.settling .spotlight-card {
  visibility: hidden;
}

.spotlight-ring {
  position: absolute;
  border: 2px solid var(--accent);
  border-radius: var(--radius);
  pointer-events: none;
}

.spotlight-card {
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

.spotlight-card.centred {
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  width: min(26rem, calc(100vw - 2rem));
}

.spotlight-card:focus {
  outline: none;
}

.spotlight-card :slotted(.tour-btn) {
  height: 2.75rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.875rem;
}

.spotlight-card :slotted(.tour-btn:hover) {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.spotlight-card :slotted(.tour-btn.quiet) {
  border-color: transparent;
  color: var(--text-muted);
}

.spotlight-card :slotted(.tour-btn.primary) {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 500;
}

@media (min-width: 640px) {
  .spotlight-card :slotted(.tour-btn) {
    height: 2.25rem;
  }
}
</style>
