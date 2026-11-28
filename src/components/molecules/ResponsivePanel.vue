<script setup lang="ts">
/**
 * Desktop (≥768px): 400px right SidePanel. Mobile: BottomSheet.
 * `collapsible`: on desktop, closing slides the panel aside to a strip
 * instead of removing it; `open` asks for it back.
 * `tabLabel` (with collapsible): a word written up the tucked panel's tab.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BottomSheet from '~/components/atoms/BottomSheet.vue';
import SidePanel from '~/components/atoms/SidePanel.vue';
import { SIDE_PANEL_QUERY } from '~/lib/breakpoints';

defineProps<{
  title: string;
  open: boolean;
  collapsible?: boolean;
  tabLabel?: string;
}>();
const emit = defineEmits<{ close: []; open: [] }>();

const desktop = ref(true);
let mediaQuery: MediaQueryList | undefined;
/**
 * Swapping layouts remounts the panel's content, which would close a modal dialog inside it (the photo lightbox).
 * The dialog covers the page anyway, so the swap waits until it closes.
 */
function update() {
  if (document.querySelector('dialog[open]')) return;
  desktop.value = !!mediaQuery?.matches;
}

onMounted(() => {
  mediaQuery = window.matchMedia(SIDE_PANEL_QUERY);
  update();
  mediaQuery.addEventListener('change', update);
  // `close` doesn't bubble, so listen in the capture phase.
  document.addEventListener('close', update, true);
});
onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', update);
  document.removeEventListener('close', update, true);
});
</script>

<template>
  <SidePanel
    v-if="desktop && collapsible"
    :title="title"
    open
    collapsible
    :collapsed="!open"
    closable
    :tab-label="tabLabel"
    @close="emit('close')"
    @collapse="emit('close')"
    @expand="emit('open')"
  >
    <template v-if="$slots.top" #top><slot name="top" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <slot />
  </SidePanel>
  <SidePanel v-else-if="desktop" :title="title" :open="open" @close="emit('close')">
    <template v-if="$slots.top" #top><slot name="top" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <slot />
  </SidePanel>
  <BottomSheet v-else :title="title" :open="open" @close="emit('close')">
    <template v-if="$slots.top" #top><slot name="top" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <slot />
  </BottomSheet>
</template>
