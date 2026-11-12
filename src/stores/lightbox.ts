/**
 * Whether a photo lightbox is open. The map pauses while one is, so a pinch-zoom in the lightbox doesn't also
 * redraw the map's canvas behind it, which can run a phone's browser out of memory.
 */
import { atom } from 'nanostores';

export const $lightboxOpen = atom(false);
