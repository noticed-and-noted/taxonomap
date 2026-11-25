// @vitest-environment jsdom
/** Zooming into a lightbox photo: the sums, and the gestures that drive them. */
import { ref } from 'vue';
import { useImageZoom } from '~/composables/useImageZoom';
import { fittedSize, MAX_ZOOM, panBy, UNZOOMED, visibleArea, zoomAt } from '~/lib/photos/zoom';

const STAGE = { width: 400, height: 300 };
/** A landscape photo filling the stage's width, with bands above and below. */
const PHOTO = { width: 400, height: 200 };
const CENTRE = { x: 0, y: 0 };

describe('photo zoom sums', () => {
  it('fits a photo whole inside the stage', () => {
    expect(fittedSize({ width: 800, height: 400 }, STAGE)).toEqual(PHOTO);
    expect(fittedSize({ width: 300, height: 600 }, STAGE)).toEqual({ width: 150, height: 300 });
  });

  it('keeps the point zoomed about under it', () => {
    const view = zoomAt(UNZOOMED, 2, { x: 100, y: 50 }, PHOTO, STAGE);
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
  });

  it('zooms no further out than the whole photo, nor further in than the maximum', () => {
    expect(zoomAt(UNZOOMED, 0.5, CENTRE, PHOTO, STAGE)).toEqual(UNZOOMED);
    expect(zoomAt(UNZOOMED, 100, CENTRE, PHOTO, STAGE).scale).toBe(MAX_ZOOM);
  });

  it('says which part of the photo is in view, for the locator', () => {
    expect(visibleArea(UNZOOMED, PHOTO, STAGE)).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    // At 2×, the 800 × 400 drawing shows its middle half across; panned fully left, its left half.
    expect(visibleArea({ scale: 2, x: 0, y: 0 }, PHOTO, STAGE)).toEqual({
      left: 0.25,
      top: 0.125,
      width: 0.5,
      height: 0.75,
    });
    expect(visibleArea({ scale: 2, x: 200, y: 0 }, PHOTO, STAGE)).toMatchObject({ left: 0, width: 0.5 });
  });

  it('pans no further than the photo’s edges, keeping a side narrower than the stage centred', () => {
    const zoomed = zoomAt(UNZOOMED, 1.2, CENTRE, PHOTO, STAGE);
    // 480 × 240 drawn: 40 px spare either side across, none down.
    expect(panBy(zoomed, 500, 500, PHOTO, STAGE)).toEqual({ scale: 1.2, x: 40, y: 0 });
    expect(panBy(zoomed, -500, -500, PHOTO, STAGE)).toEqual({ scale: 1.2, x: -40, y: 0 });
  });
});

describe('useImageZoom', () => {
  /** A stage at the top left of the page and a photo, with the gesture handlers bound to them. */
  function setup(natural = { width: 800, height: 400 }) {
    const stage = document.createElement('div');
    // Configurable, so a test can resize the stage.
    Object.defineProperties(stage, {
      clientWidth: { value: STAGE.width, configurable: true },
      clientHeight: { value: STAGE.height, configurable: true },
    });
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, ...STAGE }) as DOMRect;
    const photo = document.createElement('img');
    Object.defineProperties(photo, {
      naturalWidth: { value: natural.width },
      naturalHeight: { value: natural.height },
    });
    stage.append(photo);
    const stageRef = ref<HTMLElement | undefined>(stage);
    const photoRef = ref<HTMLImageElement | undefined>(photo);
    return { stage, photo, stageRef, photoRef, zoom: useImageZoom(stageRef, photoRef) };
  }

  const press = (target: EventTarget, pointerId: number, clientX: number, clientY: number, fields = {}) =>
    ({ target, pointerId, clientX, clientY, pointerType: 'touch', buttons: 1, ...fields }) as unknown as PointerEvent;

  const wheel = (fields: Partial<WheelEvent>) =>
    ({
      clientX: 200,
      clientY: 150,
      deltaX: 0,
      deltaY: 0,
      ctrlKey: false,
      preventDefault: vi.fn(),
      ...fields,
    }) as unknown as WheelEvent & { preventDefault: ReturnType<typeof vi.fn> };

  it('zooms with a two-finger pinch about its midpoint, then pans with one finger', () => {
    const { photo, zoom } = setup();
    zoom.onPointerDown(press(photo, 1, 150, 150));
    zoom.onPointerDown(press(photo, 2, 250, 150));
    expect(zoom.pressCount()).toBe(2);
    zoom.onPointerMove(press(photo, 2, 350, 150));
    expect(zoom.isZoomed.value).toBe(true);
    expect(zoom.transform.value).toMatch(/scale\(2\)/);
    zoom.release(press(photo, 2, 350, 150));
    const before = zoom.transform.value;
    zoom.onPointerMove(press(photo, 1, 140, 150));
    expect(zoom.transform.value).not.toBe(before);
    expect(zoom.wasDragged()).toBe(true);
  });

  it('leaves the photo still under one finger while it is whole, and counts a short press as a tap', () => {
    const { photo, zoom } = setup();
    zoom.onPointerDown(press(photo, 1, 100, 100));
    zoom.onPointerMove(press(photo, 1, 102, 100));
    expect(zoom.transform.value).toBe('translate(0px, 0px) scale(1)');
    expect(zoom.wasDragged()).toBe(false);
  });

  it('ignores presses on the controls, moves of presses it never saw, and two fingers starting together', () => {
    const { stage, photo, zoom } = setup();
    zoom.onPointerDown(press(document.createElement('button'), 1, 100, 100));
    zoom.onPointerMove(press(stage, 9, 300, 100));
    expect(zoom.pressCount()).toBe(0);
    zoom.onPointerDown(press(stage, 1, 100, 100));
    zoom.onPointerDown(press(photo, 2, 100, 100));
    zoom.onPointerMove(press(photo, 2, 200, 100));
    expect(zoom.isZoomed.value).toBe(false);
  });

  it('lets go of a mouse that comes back with its button up', () => {
    const { photo, zoom } = setup();
    zoom.onPointerDown(press(photo, 1, 100, 100, { pointerType: 'mouse' }));
    zoom.onPointerMove(press(photo, 1, 150, 100, { pointerType: 'mouse', buttons: 0 }));
    expect(zoom.pressCount()).toBe(0);
  });

  it('zooms with a trackpad pinch, pans with a two-finger scroll once zoomed, and leaves other scrolls be', () => {
    const { zoom } = setup();
    const scroll = wheel({ deltaY: 40 });
    zoom.onWheel(scroll);
    expect(scroll.preventDefault).not.toHaveBeenCalled();
    const pinch = wheel({ ctrlKey: true, deltaY: -100 });
    zoom.onWheel(pinch);
    expect(pinch.preventDefault).toHaveBeenCalled();
    expect(zoom.isZoomed.value).toBe(true);
    const before = zoom.transform.value;
    zoom.onWheel(wheel({ deltaX: 30 }));
    expect(zoom.transform.value).not.toBe(before);
  });

  it('zooms with Safari’s trackpad gestures, from each gesture’s start', () => {
    const { zoom } = setup();
    const gesture = (type: string, scale: number) =>
      Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 200, clientY: 150 });
    zoom.onGesture(gesture('gesturestart', 1));
    zoom.onGesture(gesture('gesturechange', 2));
    zoom.onGesture(gesture('gesturechange', 3));
    expect(zoom.transform.value).toMatch(/scale\(3\)/);
    expect(zoom.visibleArea.value.width).toBeCloseTo(1 / 3);
    zoom.reset();
    expect(zoom.transform.value).toBe('translate(0px, 0px) scale(1)');
  });

  it('leaves a touch pinch to the presses, though iOS also reports it as gestures', () => {
    const { photo, zoom } = setup();
    zoom.onPointerDown(press(photo, 1, 150, 150));
    zoom.onPointerDown(press(photo, 2, 250, 150));
    zoom.onGesture(
      Object.assign(new Event('gesturestart', { cancelable: true }), { scale: 1, clientX: 200, clientY: 150 }),
    );
    zoom.onPointerMove(press(photo, 2, 350, 150));
    zoom.onGesture(
      Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 2, clientX: 250, clientY: 150 }),
    );
    expect(zoom.transform.value).toMatch(/scale\(2\)/);
  });

  it('re-fits the zoom and its locator after the stage changes size', () => {
    const { stage, zoom } = setup();
    zoom.onWheel(wheel({ ctrlKey: true, deltaY: -100, clientX: 0, clientY: 0 }));
    const before = zoom.visibleArea.value;
    Object.defineProperties(stage, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    zoom.fitToStage();
    expect(zoom.visibleArea.value).not.toEqual(before);
  });

  it('pans nowhere once the stage and photo have gone, as when the lightbox closes mid-zoom', () => {
    const { stageRef, photoRef, zoom } = setup();
    zoom.onWheel(wheel({ ctrlKey: true, deltaY: -100 }));
    stageRef.value = undefined;
    photoRef.value = undefined;
    zoom.onWheel(wheel({ deltaX: 30 }));
    expect(zoom.transform.value).toMatch(/^translate\(0px, 0px\)/);
  });

  it('treats the stage as the photo before the photo has loaded, and does nothing without a stage', () => {
    const { zoom } = setup({ width: 0, height: 0 });
    zoom.onWheel(wheel({ ctrlKey: true, deltaY: -100 }));
    expect(zoom.isZoomed.value).toBe(true);
    const detached = useImageZoom(ref(), ref());
    detached.onWheel(wheel({ ctrlKey: true, deltaY: -100 }));
    expect(detached.isZoomed.value).toBe(false);
  });
});
