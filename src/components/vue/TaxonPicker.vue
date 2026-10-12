<script setup lang="ts">
/** Compact species search (baked index first, then live suggest; 250 ms debounce). */
import { ref } from 'vue';
import { bakedIndexProvider, loadNameIndex } from '~/lib/data/name-index';
import { gbifSuggestProvider, type NameHit } from '~/lib/gbif';
import { debounce } from '~/lib/util/debounce';

defineProps<{ label: string }>();
const emit = defineEmits<{ pick: [hit: NameHit] }>();

const q = ref('');
const hits = ref<NameHit[]>([]);
const active = ref(-1);
const id = `tp-${Math.random().toString(36).slice(2, 8)}`;

const live = debounce(async (text: string) => {
  if (text.trim().length < 3) return;
  const more = await gbifSuggestProvider.search(text).catch(() => []);
  const seen = new Set(hits.value.map((h) => h.key));
  hits.value = [...hits.value, ...more.filter((h) => !seen.has(h.key))].slice(0, 8);
}, 250);

async function onInput() {
  active.value = -1;
  hits.value = await bakedIndexProvider.search(q.value);
  live(q.value);
}

function choose(h: NameHit | undefined) {
  if (!h) return;
  emit('pick', h);
  q.value = '';
  hits.value = [];
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = Math.min(hits.value.length - 1, active.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = Math.max(0, active.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(hits.value[Math.max(0, active.value)]);
  } else if (e.key === 'Escape') hits.value = [];
}
</script>

<template>
  <div class="relative">
    <input
      v-model="q"
      type="search"
      role="combobox"
      :aria-label="label"
      :aria-expanded="hits.length > 0"
      :aria-controls="id"
      :aria-activedescendant="active >= 0 ? `${id}-${active}` : undefined"
      autocomplete="off"
      :placeholder="label"
      class="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm focus:border-accent focus:outline-none"
      @focus="loadNameIndex"
      @input="onInput"
      @keydown="onKey"
    />
    <ul
      v-if="hits.length"
      :id="id"
      role="listbox"
      class="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-panel"
    >
      <li
        v-for="(h, i) in hits"
        :id="`${id}-${i}`"
        :key="h.key"
        role="option"
        :aria-selected="i === active"
        class="cursor-pointer px-2 py-1 text-sm aria-selected:bg-accent-soft hover:bg-surface-2"
        @mousedown.prevent
        @click="choose(h)"
      >
        <span v-if="h.commonName" class="font-medium">{{ h.commonName }}</span>
        <span class="sci-name ml-1 text-xs text-muted">{{ h.scientificName }}</span>
      </li>
    </ul>
  </div>
</template>
