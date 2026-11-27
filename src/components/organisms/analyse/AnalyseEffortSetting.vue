<script setup lang="ts">
/** A tab's "adjust for recording effort" setting: a switch with what it does beneath. */
import { useId } from 'vue';

defineProps<{ label: string; disabled?: boolean }>();
const isOn = defineModel<boolean>({ required: true });

const descriptionId = useId();
</script>

<template>
  <div class="rounded-md bg-surface-2 p-3 text-[0.8125rem]">
    <label class="relative flex cursor-pointer items-center justify-between gap-3" :class="{ 'opacity-60': disabled }">
      <span class="font-medium">{{ label }}</span>
      <input
        v-model="isOn"
        type="checkbox"
        class="size-[1.125rem] shrink-0 accent-[var(--accent)]"
        :disabled="disabled"
        :aria-describedby="descriptionId"
      />
    </label>
    <p :id="descriptionId" class="mt-1 text-muted"><slot /></p>
  </div>
</template>
