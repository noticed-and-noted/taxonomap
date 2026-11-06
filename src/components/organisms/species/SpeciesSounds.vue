<script setup lang="ts">
/**
 * A species' recordings above its About text (client island): one player with previous and next.
 * Shows nothing when the species has none.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import UiIcon from '~/components/atoms/UiIcon.vue';
import SoundPlayer from '~/components/molecules/SoundPlayer.vue';
import SoundsSkeleton from '~/components/molecules/SoundsSkeleton.vue';
import type { Rank } from '~/lib/gbif';
import type { UsableSound } from '~/lib/gbif/licence';
import { taxonSounds } from '~/lib/photos/taxon-sounds';

const props = defineProps<{ taxonKey: number; rank: Rank }>();

const sounds = shallowRef<UsableSound[]>([]);
const position = ref(0);
// Only species have sounds, so other ranks never hold a space for them.
const isLoading = ref(props.rank === 'SPECIES');

const currentSound = computed(() => sounds.value[position.value]);
const hasSeveral = computed(() => sounds.value.length > 1);

onMounted(async () => {
  // The page reads fine without sounds, so a failed lookup just leaves them out.
  sounds.value = await taxonSounds({ key: props.taxonKey, rank: props.rank }).catch(() => []);
  isLoading.value = false;
});

/** Moves by `step` recordings, wrapping round at either end, and waits for play. */
function skip(step: number) {
  position.value = (position.value + step + sounds.value.length) % sounds.value.length;
}

/** Drops a recording the browser can't play and moves on; the last one left stays, to show why nothing plays. */
function dropUnplayable() {
  if (!hasSeveral.value) return;
  sounds.value = sounds.value.filter((_sound, index) => index !== position.value);
  position.value %= sounds.value.length;
}
</script>

<template>
  <SoundsSkeleton v-if="isLoading" />
  <section v-else-if="currentSound" class="mt-5 -mb-2" aria-label="Sounds">
    <SoundPlayer :sound="currentSound" @failed="dropUnplayable">
      <template v-if="hasSeveral" #before-play>
        <button type="button" class="skip" aria-label="Previous recording" @click="skip(-1)">
          <UiIcon name="chevron-left" size="16" />
        </button>
      </template>
      <template v-if="hasSeveral" #after-play>
        <button type="button" class="skip" aria-label="Next recording" @click="skip(1)">
          <UiIcon name="chevron-right" size="16" />
        </button>
      </template>
      <template v-if="hasSeveral" #after-credit>
        <p class="shrink-0 tabular-nums">{{ position + 1 }} of {{ sounds.length }}</p>
      </template>
    </SoundPlayer>
  </section>
</template>

<style scoped>
.skip {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.5rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition:
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}
.skip:hover {
  background: var(--surface-3);
  color: var(--text);
}
.skip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
@media (max-width: 767px) {
  .skip {
    position: relative;
    width: 1.75rem;
    height: 2.75rem;
  }
  /* Narrower to look at, but still a 44 px target to tap; it reaches only into the gaps beside the button. */
  .skip::before {
    position: absolute;
    inset: 0 -0.5rem;
    content: '';
  }
}
</style>
