<script setup lang="ts">
/** Desktop (≥768px): 400px right SidePanel. Mobile: BottomSheet. */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BottomSheet from './BottomSheet.vue';
import SidePanel from './SidePanel.vue';

defineProps<{ title: string; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

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
  <SidePanel v-if="desktop" :title="title" :open="open" @close="emit('close')"><slot /></SidePanel>
  <BottomSheet v-else :title="title" :open="open" @close="emit('close')"><slot /></BottomSheet>
</template>
