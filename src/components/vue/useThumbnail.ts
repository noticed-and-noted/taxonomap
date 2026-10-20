/** GBIF thumbnail source with load state and request counting. */
import { computed, ref, type Ref } from 'vue';
import { countRequest, thumbnailUrl, type ThumbSize, type UsableImage } from '~/lib/gbif';

/**
 * Loading state for a thumbnail image, counting its request in the meter.
 * @param image The image to show, if any.
 * @param size Thumbnail size to request.
 */
export function useThumbnail(image: Ref<UsableImage | undefined>, size: ThumbSize = '400x') {
  const loaded = ref(false);
  const broken = ref(false);

  const src = computed(() => (image.value ? thumbnailUrl(image.value, size) : undefined));

  function onLoad() {
    if (src.value) countRequest('image');
    loaded.value = true;
  }

  function onError() {
    if (src.value) countRequest('image');
    broken.value = true;
  }

  return { src, loaded, broken, onLoad, onError };
}
