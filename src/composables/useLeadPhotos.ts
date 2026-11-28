/**
 * Lead photos for a changing set of species keys, with the common names iNaturalist gave on the way.
 * Each key is asked for once; lookups stop when the component goes.
 */
import { onScopeDispose, ref, watch } from 'vue';
import type { UsableImage } from '~/lib/gbif';
import { photosForKeys } from '~/lib/species/groups';

/** Looks up photos for `keys` as new ones appear. */
export function useLeadPhotos(keys: () => readonly number[]) {
  const images = ref(new Map<number, UsableImage>());
  const commonNames = ref(new Map<number, string>());
  const answered = ref(new Set<number>());
  const asked = new Set<number>();
  const controller = new AbortController();

  async function lookUp(current: readonly number[]) {
    const ask = current.filter((key) => !asked.has(key));
    if (!ask.length) return;
    for (const key of ask) asked.add(key);
    // A failed lookup leaves the initials in place: the rows still work without photos.
    const found = await photosForKeys(ask, controller.signal).catch(() => undefined);
    if (controller.signal.aborted) return;
    if (found) {
      images.value = new Map([...images.value, ...found.images]);
      commonNames.value = new Map([...commonNames.value, ...found.commonNames]);
    }
    answered.value = new Set([...answered.value, ...ask]);
  }

  watch(keys, lookUp, { immediate: true });
  onScopeDispose(() => controller.abort());

  return {
    images,
    commonNames,
    /** Whether the key's photo is still on its way. */
    isPending: (key: number) => !answered.value.has(key),
  };
}
