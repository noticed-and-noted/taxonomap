/**
 * Touch swipes on an element: a mostly sideways swipe and a mostly upright one call separate handlers.
 * The caller can rule swipes out for a while, say while a photo is zoomed in and drags pan it instead.
 */

/** Travel, in px, that makes a touch a swipe rather than a tap. */
const SWIPE_DISTANCE = 50;

/** Handlers for each swipe direction; `step` is 1 for left or up, -1 for right or down. */
export interface SwipeHandlers {
  onSideways: (step: number) => void;
  onUpright?: (step: number) => void;
  /** Whether a touch may swipe now; asked as it starts and as it ends. Always, when left out. */
  canSwipe?: () => boolean;
}

/**
 * Pointer handlers that turn touch drags into swipes.
 * @param handlers Called with 1 for a swipe left or up (next), -1 for right or down (previous).
 */
export function useSwipe(handlers: SwipeHandlers) {
  let swipeStart: { x: number; y: number } | null = null;
  const canSwipe = handlers.canSwipe ?? (() => true);

  /** Starts a swipe on a touch, when swipes are allowed. */
  function onPointerDown(event: PointerEvent) {
    const isSwipe = event.pointerType === 'touch' && canSwipe();
    swipeStart = isSwipe ? { x: event.clientX, y: event.clientY } : null;
  }

  /** The browser took the gesture over (say, scrolling a strip), so it isn't a swipe. */
  function onPointerCancel() {
    swipeStart = null;
  }

  /** Ends a swipe, calling the handler for its main direction if it travelled far enough. */
  function onPointerUp(event: PointerEvent) {
    const start = swipeStart;
    swipeStart = null;
    if (!start || !canSwipe()) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (Math.abs(deltaX) >= SWIPE_DISTANCE) handlers.onSideways(deltaX < 0 ? 1 : -1);
    } else if (Math.abs(deltaY) >= SWIPE_DISTANCE) handlers.onUpright?.(deltaY < 0 ? 1 : -1);
  }

  return { onPointerDown, onPointerUp, onPointerCancel };
}
