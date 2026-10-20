<script setup lang="ts">
/**
 * Desktop (≥768px): 400px right SidePanel. Mobile: BottomSheet.
 * `collapsible`: on desktop, closing slides the panel aside to a strip
 * instead of removing it; `open` asks for it back.
 * `dismissible` (with collapsible): a close button that emits `dismiss`,
 * for leaving the whole mode rather than tucking the panel away.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BottomSheet from './BottomSheet.vue';
import SidePanel from './SidePanel.vue';

const props = defineProps<{ title: string; open: boolean; collapsible?: boolean; dismissible?: string }>();
const emit = defineEmits<{ close: []; open: []; dismiss: [] }>();
/** The sheet has one close button: with `dismissible` it dismisses. */
const closeSheet = () => (props.dismissible ? emit('dismiss') : emit('close'));

const desktop = ref(true);
let mediaQuery: MediaQueryList | undefined;
const update = () => (desktop.value = !!mediaQuery?.matches);

onMounted(() => {
  mediaQuery = window.matchMedia('(min-width: 768px)');
  update();
  mediaQuery.addEventListener('change', update);
});
onBeforeUnmount(() => mediaQuery?.removeEventListener('change', update));
</script>

<template>
  <SidePanel
    v-if="desktop && collapsible"
    :title="title"
    open
    collapsible
    :collapsed="!open"
    :closable="!!dismissible"
    :close-label="dismissible"
    @close="emit('dismiss')"
    @collapse="emit('close')"
    @expand="emit('open')"
  >
    <template v-if="$slots.top" #top><slot name="top" /></template>
    <slot />
  </SidePanel>
  <SidePanel v-else-if="desktop" :title="title" :open="open" @close="emit('close')">
    <template v-if="$slots.top" #top><slot name="top" /></template>
    <slot />
  </SidePanel>
  <BottomSheet v-else :title="title" :open="open" :close-label="dismissible" @close="closeSheet">
    <template v-if="$slots.top" #top><slot name="top" /></template>
    <slot />
  </BottomSheet>
</template>
