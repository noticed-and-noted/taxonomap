/** The lightbox store: the map reads it to pause while a photo is open. */
import { $lightboxOpen } from '~/stores/lightbox';

it('starts closed, and follows the lightbox opening and closing', () => {
  expect($lightboxOpen.get()).toBe(false);
  $lightboxOpen.set(true);
  expect($lightboxOpen.get()).toBe(true);
  $lightboxOpen.set(false);
});
