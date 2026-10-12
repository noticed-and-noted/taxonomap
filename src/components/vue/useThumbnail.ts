/**
 * GBIF thumbnail source with edge fallback and request counting. If a
 * thumbnail served via the edge cache fails, the edge is bypassed and the
 * image retried once against GBIF directly.
 */
import { computed, ref, type Ref } from 'vue';
import { countRequest, isEdgeUrl, markEdgeDown, thumbnailUrl, type ThumbSize, type UsableImage } from '~/lib/gbif';

export function useThumbnail(image: Ref<UsableImage | undefined>, size: ThumbSize = '400x') {
  const attempt = ref(0);
  const loaded = ref(false);
  const broken = ref(false);

  // `attempt` is read so the URL is rebuilt (with the fallback base) on retry.
  const src = computed(() => (image.value && attempt.value >= 0 ? thumbnailUrl(image.value, size) : undefined));

  function onLoad() {
    if (src.value) countRequest('image', src.value);
    loaded.value = true;
  }

  function onError() {
    const url = src.value;
    if (url) countRequest('image', url);
    if (url && isEdgeUrl(url) && attempt.value === 0) {
      markEdgeDown();
      attempt.value++;
      return;
    }
    broken.value = true;
  }

  return { src, loaded, broken, onLoad, onError };
}
