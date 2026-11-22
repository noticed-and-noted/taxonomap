/**
 * Zooms into a photo inside its stage instead of zooming the page: a pinch on a touch screen, a pinch on a
 * trackpad (a Ctrl-wheel, or Safari's gesture events). Zoomed in, a drag or a two-finger scroll pans the photo.
 */
import { computed, ref, type Ref } from 'vue';
import { fittedSize, panBy, UNZOOMED, visibleArea, zoomAt, type Size, type ZoomView } from '~/lib/photos/zoom';

/** How far a press travels, in px, before it counts as a drag rather than a tap. */
const DRAG_THRESHOLD_PX = 4;
/** How much a trackpad pinch zooms per px of its Ctrl-wheel's deltaY. */
const WHEEL_ZOOM_RATE = 0.01;

type Point = { x: number; y: number };
/** Safari's trackpad pinch, which the DOM typings leave out. */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
type PhotoView = ReturnType<typeof photoView>;

/**
 * Zoom and pan handlers for a photo, to bind on its stage.
 * @param stage The box the photo fills, which takes the gestures.
 * @param photo The photo, drawn with `object-fit: contain`.
 */
export function useImageZoom(stage: Ref<HTMLElement | undefined>, photo: Ref<HTMLImageElement | undefined>) {
  const view = photoView(stage, photo);
  /** Presses on the photo, by pointer, at where each was last seen. */
  const presses = new Map<number, Point>();
  let travelPx = 0;
  let lastGestureScale = 1;

  /** Starts following a press on the photo (or the stage round it), not on the controls over it. */
  function onPointerDown(event: PointerEvent) {
    if (event.target !== stage.value && event.target !== photo.value) return;
    if (presses.size === 0) travelPx = 0;
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  /** Pinches with two presses; pans with one once zoomed in. */
  function onPointerMove(event: PointerEvent) {
    const last = presses.get(event.pointerId);
    // A mouse that left the stage mid-drag comes back with its button up.
    if (!last || (event.pointerType === 'mouse' && event.buttons === 0)) return release(event);
    const before = [...presses.values()];
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travelPx += Math.hypot(event.clientX - last.x, event.clientY - last.y);
    if (presses.size >= 2) pinch(view, before, [...presses.values()]);
    else if (view.isZoomed.value) view.pan(event.clientX - last.x, event.clientY - last.y);
  }

  /** Stops following a press that lifted, or that the browser took over. */
  function release(event: PointerEvent) {
    presses.delete(event.pointerId);
  }

  /** Safari reports a trackpad pinch as gestures, with the scale so far. */
  function onGesture(event: Event) {
    const gesture = event as GestureEvent;
    event.preventDefault();
    // iOS sends gestures for a touch pinch too, which the presses already zoom.
    if (presses.size > 0) return;
    if (event.type === 'gesturestart') lastGestureScale = 1;
    view.zoom(gesture.scale / lastGestureScale, gesture.clientX, gesture.clientY);
    lastGestureScale = gesture.scale;
  }

  return {
    isZoomed: view.isZoomed,
    transform: view.transform,
    visibleArea: view.visibleArea,
    /** Whether the last press moved far enough to be a drag, so its click shouldn't count as a tap. */
    wasDragged: () => travelPx > DRAG_THRESHOLD_PX,
    pressCount: () => presses.size,
    /** Keeps the zoom within the photo's edges, and the locator true, after the stage changes size. */
    fitToStage: view.fitToStage,
    /** Back to the whole photo, as when another one shows. */
    reset: () => {
      view.reset();
      presses.clear();
    },
    onPointerDown,
    onPointerMove,
    release,
    onWheel: (event: WheelEvent) => onWheel(view, event),
    onGesture,
  };
}

/** The photo's zoom and pan, kept within its edges as drawn in the stage. */
function photoView(stage: Ref<HTMLElement | undefined>, photo: Ref<HTMLImageElement | undefined>) {
  const view = ref<ZoomView>(UNZOOMED);

  /** The photo's size as drawn unzoomed (the stage's, until it loads), and the stage's. */
  function sizes(): [Size, Size] {
    const box = { width: stage.value?.clientWidth ?? 0, height: stage.value?.clientHeight ?? 0 };
    const natural = { width: photo.value?.naturalWidth ?? 0, height: photo.value?.naturalHeight ?? 0 };
    return [natural.width && natural.height ? fittedSize(natural, box) : box, box];
  }

  /** Zooms by a factor about a point on screen. */
  function zoom(factor: number, clientX: number, clientY: number) {
    const rect = stage.value?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
    view.value = zoomAt(view.value, factor, point, ...sizes());
  }

  return {
    isZoomed: computed(() => view.value.scale > 1),
    transform: computed(() => `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.scale})`),
    /** The part of the photo in view, recomputed as the zoom changes. */
    visibleArea: computed(() => visibleArea(view.value, ...sizes())),
    zoom,
    pan: (deltaX: number, deltaY: number) => (view.value = panBy(view.value, deltaX, deltaY, ...sizes())),
    fitToStage: () => (view.value = panBy(view.value, 0, 0, ...sizes())),
    reset: () => (view.value = UNZOOMED),
  };
}

/** A trackpad pinch (a Ctrl-wheel) zooms; zoomed in, a two-finger scroll pans. Other scrolls are left alone. */
function onWheel(view: PhotoView, event: WheelEvent) {
  if (event.ctrlKey) view.zoom(Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), event.clientX, event.clientY);
  else if (view.isZoomed.value) view.pan(-event.deltaX, -event.deltaY);
  else return;
  event.preventDefault();
}

/** Two fingers: pan with their midpoint, and zoom by how far they spread. */
function pinch(view: PhotoView, [firstBefore, secondBefore]: Point[], [firstAfter, secondAfter]: Point[]) {
  const spreadBefore = distance(firstBefore!, secondBefore!);
  const middleBefore = midpoint(firstBefore!, secondBefore!);
  const middleAfter = midpoint(firstAfter!, secondAfter!);
  view.pan(middleAfter.x - middleBefore.x, middleAfter.y - middleBefore.y);
  if (spreadBefore > 0) view.zoom(distance(firstAfter!, secondAfter!) / spreadBefore, middleAfter.x, middleAfter.y);
}

/** The straight-line distance between two points. */
function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** The point halfway between two others. */
function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
