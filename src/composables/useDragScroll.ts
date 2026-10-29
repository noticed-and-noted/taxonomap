/**
 * Drag-to-scroll for a sideways scroll box with a mouse. Touch already
 * scrolls natively, so only mouse presses are handled.
 */
import type { Ref } from 'vue';

/** Past this many pixels a press is a drag, and the click it ends with is swallowed. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Lets a mouse drag scroll a box sideways without the release clicking what it lands on.
 * @param scrollBox The scrollable element.
 * @returns Handlers to bind as `@pointerdown` and `@click.capture` on the box.
 */
export function useDragScroll(scrollBox: Ref<HTMLElement | undefined>) {
  let startX = 0;
  let startScroll = 0;
  let isDragging = false;

  function onPointerMove(event: PointerEvent) {
    const element = scrollBox.value;
    if (!element) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) > DRAG_THRESHOLD_PX) isDragging = true;
    if (isDragging) element.scrollLeft = startScroll - distance;
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerDown(event: PointerEvent) {
    const element = scrollBox.value;
    if (event.pointerType !== 'mouse' || event.button !== 0 || !element) return;
    startX = event.clientX;
    startScroll = element.scrollLeft;
    isDragging = false;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onClickCapture(event: MouseEvent) {
    if (!isDragging) return;
    event.stopPropagation();
    event.preventDefault();
    isDragging = false;
  }

  return { onPointerDown, onClickCapture };
}
