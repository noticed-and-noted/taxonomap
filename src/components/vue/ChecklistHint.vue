<script setup lang="ts">
/**
 * A "Try this" item's help: spotlights where to click (see tourTargets.ts)
 * with a short tip. Clicks pass through the spotlight, so the viewer clicks
 * the real control; any click, Escape, "Got it" or doing the item closes it.
 */
import { useStore } from '@nanostores/vue';
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { $busiestHexBox, $busiestHexRequest } from '~/stores/explorer';
import { $checklistDone, $checklistHint, CHECKLIST, type ChecklistId } from '~/stores/onboarding';
import Spotlight from './Spotlight.vue';
import { HINTS } from './tourTargets';

const props = defineProps<{ id: ChecklistId }>();

const titleId = useId();
const spotlight = ref<InstanceType<typeof Spotlight>>();
const done = useStore($checklistDone);
const hint = computed(() => HINTS[props.id]);
const title = computed(() => CHECKLIST.find((item) => item.id === props.id)?.title);

const close = () => $checklistHint.set(null);

function onSettled(count: number) {
  if (!count) close();
}

// Doing the thing is the clearest sign the hint has served its purpose.
const stopWatchingDone = $checklistDone.listen((ids) => ids.includes(props.id) && close());
// The map moves the hex's box when it resizes.
const stopFollowingHex = $busiestHexBox.listen(() => spotlight.value?.measure());

onMounted(() => {
  if (!hint.value.needsHex) return;
  $busiestHexBox.set(null);
  $busiestHexRequest.set('locate');
});

onBeforeUnmount(() => {
  stopWatchingDone();
  stopFollowingHex();
  if (hint.value.needsHex) $busiestHexBox.set(null);
  // Leaving the page (Tree of life) ends the hint, so it doesn't come back on return; a newer hint stays.
  if ($checklistHint.get() === props.id) close();
});
</script>

<template>
  <Spotlight
    v-if="!done.includes(id)"
    ref="spotlight"
    click-through
    :targets="hint.targets"
    :step-key="id"
    :labelledby="titleId"
    @settled="onSettled"
    @close="close"
    @dismiss="close"
  >
    <h2 :id="titleId" class="font-display text-lg">{{ title }}</h2>
    <p class="mt-1 text-sm text-muted">{{ hint.body }}</p>
    <div class="mt-3 flex justify-end">
      <button type="button" class="tour-btn primary" @click="close">Got it</button>
    </div>
  </Spotlight>
</template>
