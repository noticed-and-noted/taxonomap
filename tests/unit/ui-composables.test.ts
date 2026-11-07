// @vitest-environment jsdom
/** The small interaction composables: dragging, swiping, scroll fades, settled search text and photo loading. */
import { createApp, defineComponent, effectScope, nextTick, ref } from 'vue';
import { useDragScroll } from '~/composables/useDragScroll';
import { usePhotoPreload } from '~/composables/usePhotoPreload';
import { useScrollFade } from '~/composables/useScrollFade';
import { useSettledQuery } from '~/composables/useSettledQuery';
import { useSwipe, type SwipeHandlers } from '~/composables/useSwipe';
import { useThumbnail } from '~/composables/useThumbnail';
import { $requestCounts, resetRequestCounts, type UsableImage } from '~/lib/gbif';
import { SEARCH_DEBOUNCE_MS } from '~/lib/util/debounce';

const GBIF_PHOTO: UsableImage = { url: 'https://photos.test/a.jpg', licence: 'CC0', occurrenceKey: 1, datasetKey: 'd' };
const inatPhoto = (id: number): UsableImage => ({
  source: 'inat',
  photoId: id,
  licence: 'CC-BY',
  url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/square.jpg`,
});

/** A pointer event with just the fields the composables read. */
const pointer = (fields: Partial<PointerEvent>) => ({ pointerType: 'mouse', button: 0, ...fields }) as PointerEvent;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetRequestCounts();
});

describe('useDragScroll', () => {
  function setUp() {
    const element = document.createElement('div');
    element.scrollLeft = 100;
    const box = ref<HTMLElement | undefined>(element);
    return { element, box, ...useDragScroll(box) };
  }

  const move = (clientX: number) => window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX }));

  it('scrolls the box with a mouse drag, then swallows the click it ends with', () => {
    const { element, onPointerDown, onClickCapture } = setUp();
    onPointerDown(pointer({ clientX: 50 }));
    move(52);
    expect(element.scrollLeft).toBe(100);
    move(30);
    expect(element.scrollLeft).toBe(120);
    window.dispatchEvent(new Event('pointerup'));
    move(0);
    expect(element.scrollLeft).toBe(120);

    const click = { stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as MouseEvent;
    onClickCapture(click);
    expect(click.preventDefault).toHaveBeenCalled();
    onClickCapture(click);
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores touch, other buttons, and a box that has gone', () => {
    const { element, box, onPointerDown } = setUp();
    onPointerDown(pointer({ pointerType: 'touch', clientX: 50 }));
    onPointerDown(pointer({ button: 2, clientX: 50 }));
    move(0);
    expect(element.scrollLeft).toBe(100);

    onPointerDown(pointer({ clientX: 50 }));
    box.value = undefined;
    move(0);
    window.dispatchEvent(new Event('pointercancel'));
    onPointerDown(pointer({ clientX: 50 }));
    expect(element.scrollLeft).toBe(100);
  });
});

describe('useScrollFade', () => {
  it('fades each edge with more content beyond it', () => {
    const element = document.createElement('div');
    Object.defineProperties(element, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
      clientWidth: { value: 100 },
      scrollWidth: { value: 100 },
    });
    element.scrollTop = 50;
    const box = ref<HTMLElement | undefined>(element);
    const fades = useScrollFade(box);
    fades.update();
    expect([fades.fadeTop.value, fades.fadeBottom.value, fades.fadeLeft.value, fades.fadeRight.value]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    box.value = undefined;
    fades.update();
    expect(fades.fadeTop.value || fades.fadeBottom.value || fades.fadeLeft.value || fades.fadeRight.value).toBe(false);
  });
});

describe('useSettledQuery', () => {
  it('follows the text once typing pauses, and clears at once', async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const query = ref('');
    const { settled, isSettling } = scope.run(() => useSettledQuery(query))!;
    query.value = 'rob';
    await nextTick();
    expect(isSettling.value).toBe(true);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(settled.value).toBe('rob');
    expect(isSettling.value).toBe(false);

    query.value = 'robin';
    await nextTick();
    query.value = ' ';
    await nextTick();
    expect(settled.value).toBe(' ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(settled.value).toBe(' ');
    scope.stop();
  });
});

describe('useSwipe', () => {
  /** Mounts a component using the swipe handlers, so its mount hooks run. */
  function mountSwipe(handlers: SwipeHandlers) {
    let swipe!: ReturnType<typeof useSwipe>;
    const app = createApp(
      defineComponent({
        setup() {
          swipe = useSwipe(handlers);
          return () => null;
        },
      }),
    );
    app.mount(document.createElement('div'));
    return { swipe, unmount: () => app.unmount() };
  }

  function drag(swipe: ReturnType<typeof useSwipe>, deltaX: number, deltaY: number, pointerType = 'touch') {
    swipe.onPointerDown(pointer({ pointerType, clientX: 100, clientY: 100 }));
    swipe.onPointerUp(pointer({ clientX: 100 + deltaX, clientY: 100 + deltaY }));
  }

  it('turns long touch drags into steps, sideways or upright', () => {
    const onSideways = vi.fn();
    const onUpright = vi.fn();
    const { swipe, unmount } = mountSwipe({ onSideways, onUpright });
    drag(swipe, -60, 5);
    drag(swipe, 60, 5);
    drag(swipe, 20, 5);
    drag(swipe, 5, -60);
    drag(swipe, 5, 60);
    drag(swipe, 5, 20);
    expect(onSideways.mock.calls).toEqual([[1], [-1]]);
    expect(onUpright.mock.calls).toEqual([[1], [-1]]);
    unmount();
  });

  it('ignores mouse drags, cancelled gestures, upright swipes without a handler, and drags while zoomed in', () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    const onSideways = vi.fn();
    const { swipe, unmount } = mountSwipe({ onSideways });
    drag(swipe, -60, 0, 'mouse');
    swipe.onPointerDown(pointer({ pointerType: 'touch', clientX: 100, clientY: 100 }));
    swipe.onPointerCancel();
    swipe.onPointerUp(pointer({ clientX: 0, clientY: 100 }));
    drag(swipe, 0, -60);
    viewport.scale = 2;
    viewport.dispatchEvent(new Event('resize'));
    expect(swipe.isPinchZoomed.value).toBe(true);
    drag(swipe, -60, 0);
    expect(onSideways).not.toHaveBeenCalled();
    unmount();
  });

  it('treats a page without a visual viewport as not zoomed', () => {
    vi.stubGlobal('visualViewport', undefined);
    const { swipe, unmount } = mountSwipe({ onSideways: () => {} });
    expect(swipe.isPinchZoomed.value).toBe(false);
    unmount();
  });
});

describe('useThumbnail', () => {
  it('counts a loaded or broken thumbnail once it has a source', () => {
    const image = ref<UsableImage | undefined>(GBIF_PHOTO);
    const thumb = useThumbnail(image);
    expect(thumb.src.value).toContain('/v1/image/cache/400x/occurrence/1/');
    thumb.onLoad();
    thumb.onError();
    expect([thumb.loaded.value, thumb.broken.value]).toEqual([true, true]);
    expect($requestCounts.get().image).toBe(2);

    image.value = undefined;
    const small = useThumbnail(image, '200x');
    expect(small.src.value).toBeUndefined();
    small.onLoad();
    small.onError();
    expect($requestCounts.get().image).toBe(2);
  });
});

describe('usePhotoPreload', () => {
  /** Images the composable creates, so a test can fire their load or error. */
  function stubImages() {
    class FakeImage {
      decoding = '';
      crossOrigin: string | null = null;
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        created.push(this);
      }
    }
    const created: FakeImage[] = [];
    vi.stubGlobal('Image', FakeImage);
    return created;
  }

  it('preloads each photo once, settling it when it loads', () => {
    const created = stubImages();
    const photos = usePhotoPreload();
    photos.preload(undefined);
    photos.preload(GBIF_PHOTO);
    photos.preload(GBIF_PHOTO);
    expect(created).toHaveLength(1);
    expect(created[0]!.crossOrigin).toBeNull();
    created[0]!.onload!();
    expect(photos.settled.has(created[0]!.src)).toBe(true);
    photos.preload(GBIF_PHOTO);
    expect(created).toHaveLength(1);
    expect($requestCounts.get().image).toBe(1);
  });

  it('retries an iNaturalist photo without CORS, then marks it failed', () => {
    const created = stubImages();
    const photos = usePhotoPreload();
    photos.preload(inatPhoto(1));
    expect(created[0]!.crossOrigin).toBe('anonymous');
    created[0]!.onerror!();
    expect(created).toHaveLength(2);
    expect(created[1]!.crossOrigin).toBeNull();
    created[1]!.onerror!();
    expect(photos.failed.has(created[1]!.src)).toBe(true);
    photos.settle(created[1]!.src, true);
    expect($requestCounts.get().image).toBe(1);
  });

  it('remounts a shown photo for a retry without CORS, else marks it failed', () => {
    const photos = usePhotoPreload();
    const url = 'https://inaturalist-open-data.s3.amazonaws.com/photos/2/large.jpg?x-cors';
    photos.onError(url);
    expect(photos.attempt.value).toBe(1);
    photos.onError(url);
    expect(photos.failed.has(url)).toBe(true);
  });
});

describe('record list scrolling', () => {
  /** A list box inside a scrolling panel, with a row and its details row. */
  function listInPanel(boxRect: DOMRect, panelRect?: DOMRect) {
    const panel = document.createElement('div');
    if (panelRect) panel.className = 'overflow-y-auto';
    panel.getBoundingClientRect = () => panelRect ?? new DOMRect();
    const box = document.createElement('div');
    box.getBoundingClientRect = () => boxRect;
    panel.append(box);
    const row = document.createElement('div');
    const details = document.createElement('div');
    box.append(row, details);
    document.body.append(panel);
    const place = (element: HTMLElement, top: number, height: number) =>
      (element.getBoundingClientRect = () => new DOMRect(0, top, 100, height));
    return { box, row, details, place };
  }

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.className = '';
  });

  it('scrolls the list up to a row above it, and down to details below the panel’s edge', async () => {
    const { revealInList } = await import('~/components/organisms/cell/recordListScroll');
    const { box, row, details, place } = listInPanel(new DOMRect(0, 100, 100, 400), new DOMRect(0, 0, 100, 300));
    box.scrollTop = 200;
    place(row, 50, 20);
    place(details, 70, 40);
    revealInList(box, details);
    expect(box.scrollTop).toBe(150);

    place(row, 250, 20);
    place(details, 270, 60);
    revealInList(box, details);
    expect(box.scrollTop).toBe(180);

    place(row, 150, 20);
    place(details, 170, 20);
    revealInList(box, details);
    expect(box.scrollTop).toBe(180);
  });

  it('keeps a lone row in view, and does nothing without a row or a list', async () => {
    const { revealInList } = await import('~/components/organisms/cell/recordListScroll');
    const { box, row, place } = listInPanel(new DOMRect(0, 100, 100, 100));
    row.remove();
    const lone = box.firstElementChild as HTMLElement;
    box.scrollTop = 0;
    place(lone, 180, 60);
    revealInList(box, lone);
    expect(box.scrollTop).toBe(40);
    revealInList(box, null);
    revealInList(undefined, lone);
    expect(box.scrollTop).toBe(40);
  });

  it('clips the view transition to the list while it runs', async () => {
    const { startListTransition } = await import('~/components/organisms/cell/recordListScroll');
    const { box } = listInPanel(new DOMRect(10, 100, 200, 400), new DOMRect(0, 0, 300, 300));
    const root = document.documentElement;
    let wasClipped = false;
    document.startViewTransition = ((update: () => Promise<void>) => {
      wasClipped = root.classList.contains('records-transition');
      return { finished: update() };
    }) as never;
    await startListTransition(box, async () => {});
    expect(wasClipped).toBe(true);
    expect(root.style.getPropertyValue('--records-clip')).toBe('rect(100px 210px 300px 10px)');
    expect(root.classList.contains('records-transition')).toBe(false);
    await startListTransition(undefined, async () => {});
    expect(root.classList.contains('records-transition')).toBe(false);
  });
});
