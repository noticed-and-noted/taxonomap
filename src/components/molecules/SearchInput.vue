<script setup lang="ts">
/**
 * The house search box: a text field with a leading icon, a spinner while results load and a
 * clear button. The browser's own clear button is hidden, as iOS Safari never draws it.
 * Attributes (id, placeholder, role, aria-*, listeners) go on the input; v-model is its text.
 * `bare` drops the box styling, for a field inside a pill that draws its own; the pill's padding
 * already insets the clear button, so it sits further out to match the leading icon's gap.
 */
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';

defineOptions({ inheritAttrs: false });

/** Lookups quicker than this finish without the spinner flashing up. */
const SPINNER_DELAY_MS = 300;

const query = defineModel<string>({ required: true });

const {
  icon = 'search',
  loading = false,
  loadingLabel = 'Looking up species names',
  bare = false,
} = defineProps<{ icon?: 'search' | 'place' | 'none'; loading?: boolean; loadingLabel?: string; bare?: boolean }>();

const input = useTemplateRef<HTMLInputElement>('input');

const isSpinning = ref(false);
let spinnerTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => loading,
  (isLoading) => {
    clearTimeout(spinnerTimer);
    if (isLoading) spinnerTimer = setTimeout(() => (isSpinning.value = true), SPINNER_DELAY_MS);
    else isSpinning.value = false;
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTimeout(spinnerTimer));

defineExpose({ input });

// Clears as the browser's button does, so v-model and the caller's input listeners both see it.
function clear() {
  if (!input.value) return;
  input.value.value = '';
  input.value.dispatchEvent(new Event('input', { bubbles: true }));
  input.value.focus();
}
</script>

<template>
  <span class="relative block">
    <svg
      v-if="icon !== 'none'"
      class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <template v-if="icon === 'place'">
        <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </template>
      <template v-else>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </template>
    </svg>
    <input
      ref="input"
      v-model="query"
      type="search"
      v-bind="$attrs"
      class="search-input w-full min-w-0 text-sm"
      :class="[
        bare
          ? 'bg-transparent'
          : 'rounded-md border border-border-strong bg-surface-2 py-1.5 placeholder:text-subtle disabled:opacity-60',
        { 'pl-8': icon !== 'none', 'pl-2.5': icon === 'none' && !bare, 'spinner-room': isSpinning && query },
      ]"
    />
    <Transition name="search-fade">
      <span
        v-if="isSpinning"
        class="pointer-events-none absolute top-1/2 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-border-strong border-t-accent motion-reduce:animate-none"
        :class="query ? 'right-9' : 'right-2.5'"
        aria-hidden="true"
      ></span>
    </Transition>
    <span class="sr-only" role="status">{{ isSpinning ? loadingLabel : '' }}</span>
    <!-- pointerdown.prevent keeps focus in the box, so the phone keyboard stays up. -->
    <Transition name="search-fade">
      <button
        v-if="query && !$attrs.disabled"
        type="button"
        class="absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-muted after:absolute after:-inset-2 hover:text-text"
        :class="bare ? '-right-1' : 'right-1'"
        aria-label="Clear search"
        @pointerdown.prevent
        @click="clear"
      >
        <UiIcon name="close" size="1rem" />
      </button>
    </Transition>
  </span>
</template>

<style scoped>
.search-input {
  padding-right: 2rem;
}

.search-input.spinner-room {
  padding-right: 3.5rem;
}

.search-input::-webkit-search-cancel-button {
  display: none;
}

.search-fade-enter-active,
.search-fade-leave-active {
  transition: opacity var(--dur-fast) var(--ease);
}

.search-fade-enter-from,
.search-fade-leave-to {
  opacity: 0;
}
</style>
