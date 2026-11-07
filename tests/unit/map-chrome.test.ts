// @vitest-environment jsdom
/** The floating chrome over the map, where places land on the canvas, and the pin cursor. */
import type { Map as MlMap } from 'maplibre-gl';
import { busiestInView, coveredEdges, ringBox } from '~/lib/map/chrome';
import type { Hex, LngLat } from '~/lib/map/occGrid';
import { PIN_CURSOR } from '~/lib/map/pinCursors';
import { fillsCanvas, isOnScreen, placeAt } from '~/lib/map/screen';

const WIDTH = 1000;
const HEIGHT = 800;

/** A flat map: 1° is 10 px, centred on 0,0 in a 1000×800 box. */
function flatMap(centre = { lng: 0, lat: 0 }) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
  const canvas = { clientWidth: WIDTH, clientHeight: HEIGHT };
  return {
    getContainer: () => container,
    getCanvas: () => canvas,
    getCenter: () => centre,
    project: (place: LngLat | { lng: number; lat: number }) => {
      const [lng, lat] = Array.isArray(place) ? place : [place.lng, place.lat];
      return { x: WIDTH / 2 + lng * 10, y: HEIGHT / 2 - lat * 10 };
    },
    unproject: ([pixelX, pixelY]: [number, number]) => ({
      lng: (pixelX - WIDTH / 2) / 10,
      lat: (HEIGHT / 2 - pixelY) / 10,
    }),
  } as unknown as MlMap;
}

/** A square cell centred on a place. */
function hexAt([lng, lat]: LngLat, total: number): Hex {
  const ring: LngLat[] = [
    [lng - 1, lat - 1],
    [lng + 1, lat - 1],
    [lng + 1, lat + 1],
    [lng - 1, lat + 1],
    [lng - 1, lat - 1],
  ];
  return {
    type: 'Feature',
    properties: { id: `${lng},${lat}`, total, home: true },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function addElement(className: string, rect: DOMRect, offsetHeight = 0) {
  const element = document.createElement('div');
  element.className = className;
  element.getBoundingClientRect = () => rect;
  Object.defineProperty(element, 'offsetHeight', { value: offsetHeight });
  document.body.append(element);
}

function stubMatchMedia(isWide: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: isWide }));
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--panel-width');
  vi.unstubAllGlobals();
});

describe('coveredEdges', () => {
  it('covers nothing when no chrome is shown', () => {
    expect(coveredEdges(flatMap())).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('measures the header, the sheet (at most half the map) and an open side panel', () => {
    addElement('app-header', new DOMRect(0, 0, WIDTH, 60));
    addElement('bottom-sheet', new DOMRect(0, 0, 0, 0), 600);
    addElement('side-panel', new DOMRect(600, 0, 400, HEIGHT));
    expect(coveredEdges(flatMap())).toEqual({ top: 60, bottom: HEIGHT / 2, left: 0, right: 400 });
  });

  it('ignores a collapsed side panel', () => {
    addElement('side-panel collapsed', new DOMRect(600, 0, 400, HEIGHT));
    expect(coveredEdges(flatMap()).right).toBe(0);
  });
});

describe('busiestInView', () => {
  it('picks the busiest cell clear of the side panel on wide screens', () => {
    stubMatchMedia(true);
    document.documentElement.style.setProperty('--panel-width', '300px');
    const hexes = [hexAt([0, 0], 5), hexAt([-10, 0], 9), hexAt([30, 0], 99), hexAt([0, 2], 2)];
    expect(busiestInView(flatMap(), hexes)?.properties.total).toBe(9);
  });

  it('falls back to the default panel width when the token is unset', () => {
    stubMatchMedia(true);
    expect(busiestInView(flatMap(), [hexAt([-5, 0], 3), hexAt([10, 0], 30)])?.properties.total).toBe(3);
  });

  it('keeps clear of the opening bottom sheet on narrow screens', () => {
    stubMatchMedia(false);
    const hexes = [hexAt([0, 20], 4), hexAt([0, -20], 50)];
    expect(busiestInView(flatMap(), hexes)?.properties.total).toBe(4);
  });

  it('skips cells facing away from the viewer', () => {
    stubMatchMedia(false);
    expect(busiestInView(flatMap({ lng: 120, lat: 0 }), [hexAt([0, 20], 4)])).toBeUndefined();
  });
});

describe('ringBox', () => {
  it('boxes a ring in viewport px', () => {
    const ring: LngLat[] = [
      [0, 0],
      [2, 0],
      [2, 1],
    ];
    expect(ringBox(flatMap(), ring)).toEqual({ left: 500, top: 390, width: 20, height: 10 });
  });
});

describe('screen', () => {
  it('finds the place under a pixel, or null off the globe', () => {
    expect(placeAt(flatMap(), 510, 400)).toEqual([1, 0]);
    const offGlobe = Object.assign({}, flatMap(), { unproject: () => ({ lng: 90, lat: 0 }) }) as MlMap;
    expect(placeAt(offGlobe, 0, 0)).toBeNull();
  });

  it('says whether a place is on the canvas and on the near side', () => {
    const map = flatMap();
    expect(isOnScreen(map, [0, 0])).toBe(true);
    expect(isOnScreen(map, [-60, 0])).toBe(false);
    expect(isOnScreen(map, [0, -50])).toBe(false);
    expect(isOnScreen(map, [60, 0])).toBe(false);
    expect(isOnScreen(map, [0, 50])).toBe(false);
    const farSide = Object.assign({}, map, { unproject: () => ({ lng: 1, lat: 0 }) }) as MlMap;
    expect(isOnScreen(farSide, [0, 0])).toBe(false);
    const wrongLat = Object.assign({}, map, { unproject: () => ({ lng: 0, lat: 3 }) }) as MlMap;
    expect(isOnScreen(wrongLat, [0, 0])).toBe(false);
  });

  it('says whether the map covers the whole canvas', () => {
    expect(fillsCanvas(flatMap())).toBe(true);
    const globe = Object.assign({}, flatMap(), { unproject: () => ({ lng: 0, lat: 0 }) }) as MlMap;
    expect(fillsCanvas(globe)).toBe(false);
  });
});

describe('PIN_CURSOR', () => {
  it('is an SVG cursor centred on its hotspot with a crosshair fallback', () => {
    expect(PIN_CURSOR).toMatch(/^url\("data:image\/svg\+xml,%3Csvg.*"\) 16 16, crosshair$/);
  });
});
