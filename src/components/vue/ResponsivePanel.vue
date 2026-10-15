<script setup lang="ts">
/**
 * Desktop (≥768px): 400px right SidePanel. Mobile: BottomSheet.
 * `collapsible`: on desktop, closing slides the panel aside to a strip
 * instead of removing it; `open` asks for it back.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BottomSheet from './BottomSheet.vue';
import SidePanel from './SidePanel.vue';

defineProps<{ title: string; open: boolean; collapsible?: boolean }>();
const emit = defineEmits<{ close: []; open: [] }>();

const desktop = ref(true);
let mq: MediaQueryList | undefined;
const update = () => (desktop.value = !!mq?.matches);

onMounted(() => {
  mq = window.matchMedia('(min-width: 768px)');
  update();
  mq.addEventListener('change', update);
});
onBeforeUnmount(() => mq?.removeEventListener('change', update));
</script>

<template>
  <SidePanel
    v-if="desktop && collapsible"
    :title="title"
    open
    collapsible
    :collapsed="!open"
    @collapse="emit('close')"
    @expand="emit('open')"
  >
    <slot />
  </SidePanel>
  <SidePanel v-else-if="desktop" :title="title" :open="open" @close="emit('close')"><slot /></SidePanel>
  <BottomSheet v-else :title="title" :open="open" @close="emit('close')"><slot /></BottomSheet>
</template>
