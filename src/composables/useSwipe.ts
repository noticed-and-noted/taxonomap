/**
 * Touch swipes on an element: a mostly sideways swipe and a mostly upright one call separate handlers.
 * Pinch-zoomed in, drags pan round the zoomed page instead, so they aren't swipes.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Travel, in px, that makes a touch a swipe rather than a tap. */
const SWIPE_DISTANCE = 50;

/** Handlers for each swipe direction; `step` is 1 for left or up, -1 for right or down. */
export interface SwipeHandlers {
  onSideways: (step: number) => void;
  onUpright?: (step: number) => void;
}

/**
 * Pointer handlers that turn touch drags into swipes.
 * @param handlers Called with 1 for a swipe left or up (next), -1 for right or down (previous).
 */
export function useSwipe(handlers: SwipeHandlers) {
  let swipeStart: { x: number; y: number } | null = null;
  const isPinchZoomed = ref(false);
  const trackPinchZoom = () => (isPinchZoomed.value = (window.visualViewport?.scale ?? 1) > 1);
  onMounted(() => window.visualViewport?.addEventListener('resize', trackPinchZoom));
  onBeforeUnmount(() => window.visualViewport?.removeEventListener('resize', trackPinchZoom));

  /** Starts a swipe on a touch, unless the page is zoomed in. */
  function onPointerDown(event: PointerEvent) {
    const isSwipe = event.pointerType === 'touch' && !isPinchZoomed.value;
    swipeStart = isSwipe ? { x: event.clientX, y: event.clientY } : null;
  }

  /** The browser took the gesture over (say, scrolling a strip), so it isn't a swipe. */
  function onPointerCancel() {
    swipeStart = null;
  }

  /** Ends a swipe, calling the handler for its main direction if it travelled far enough. */
  function onPointerUp(event: PointerEvent) {
    if (!swipeStart) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (Math.abs(deltaX) >= SWIPE_DISTANCE) handlers.onSideways(deltaX < 0 ? 1 : -1);
    } else if (Math.abs(deltaY) >= SWIPE_DISTANCE) handlers.onUpright?.(deltaY < 0 ? 1 : -1);
  }

  return { isPinchZoomed, onPointerDown, onPointerUp, onPointerCancel };
}
