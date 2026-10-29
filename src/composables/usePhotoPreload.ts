/**
 * Loading state for full-size (800x) photos: which have loaded or failed, and preloading of
 * neighbours so stepping through a set is usually instant. Each photo counts as one image request.
 */
import { reactive, ref } from 'vue';
import { countRequest, photoCrossOrigin, retryWithoutCors, thumbnailUrl, type UsableImage } from '~/lib/gbif';

/** The size the lightbox shows. */
const FULL_SIZE = '800x';

/** Tracks and preloads full-size photos. */
export function usePhotoPreload() {
  /** Photo URLs that have finished loading (or failed), so their skeletons can go. */
  const settled = reactive(new Set<string>());
  const failed = reactive(new Set<string>());
  const preloading = new Set<string>();
  /** Bumped to remount the <img> for a retry without crossorigin. */
  const attempt = ref(0);

  /** Records that a photo has loaded (or failed), once. */
  function settle(url: string, isLoaded: boolean) {
    if (settled.has(url)) return;
    countRequest('image');
    settled.add(url);
    if (!isLoaded) failed.add(url);
  }

  /** A shown photo failed: retry it without CORS when that may help, else mark it failed. */
  function onError(url: string) {
    if (retryWithoutCors(url)) attempt.value++;
    else settle(url, false);
  }

  /** Fetches a photo ahead of showing it, in the same CORS mode the <img> will use. */
  function preload(image: UsableImage | undefined) {
    if (!image) return;
    const url = thumbnailUrl(image, FULL_SIZE);
    if (settled.has(url) || preloading.has(url)) return;
    preloading.add(url);
    const element = new Image();
    element.decoding = 'async';
    const cors = photoCrossOrigin(url);
    if (cors) element.crossOrigin = cors;
    element.onload = () => settle(url, true);
    element.onerror = () => {
      if (!retryWithoutCors(url)) return settle(url, false);
      preloading.delete(url);
      preload(image);
    };
    element.src = url;
  }

  return { settled, failed, attempt, settle, onError, preload };
}
