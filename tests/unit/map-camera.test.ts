// @vitest-environment jsdom
/** Camera flights: to a point clear of the chrome, fitting a box, and keeping a box's size at another centre. */
import type { Map as MlMap } from 'maplibre-gl';
import { flyMap, flyToBounds } from '~/lib/map/camera';
import { zoomDrop } from '~/lib/map/occGrid';

const motion = vi.hoisted(() => ({ isReduced: false }));
vi.mock('~/stores/reading', () => ({ prefersReducedMotion: () => motion.isReduced }));

const WIDTH = 1000;
const HEIGHT = 800;
const BOX = [-10, 40, 10, 60] as const;

/** A stand-in map whose camera calls are spies; `camera` is what cameraForBounds answers. */
function fakeMap(camera?: { center?: [number, number] | { lng: number; lat: number }; zoom?: number }) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
  return {
    getContainer: () => container,
    getZoom: () => 3,
    getMinZoom: () => 1,
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    cameraForBounds: vi.fn(() => camera),
  };
}

const asMap = (map: ReturnType<typeof fakeMap>) => map as unknown as MlMap;

/** Puts the floating header over the top 60 px of the map. */
function showHeader() {
  const header = document.createElement('div');
  header.className = 'app-header';
  header.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, 60);
  document.body.append(header);
}

afterEach(() => {
  document.body.replaceChildren();
  motion.isReduced = false;
});

describe('flyMap', () => {
  it('flies to a point, offset clear of the header', () => {
    showHeader();
    const map = fakeMap();
    flyMap(asMap(map), { kind: 'point', lng: 2, lat: 48, zoom: 6 });
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [2, 48],
      zoom: 6,
      offset: [0, 30],
      duration: 1400,
      essential: false,
    });
  });

  it('jumps when the viewer asks for less motion', () => {
    motion.isReduced = true;
    const map = fakeMap();
    flyMap(asMap(map), { kind: 'point', lng: 2, lat: 48, zoom: 6 });
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  });

  it('fits a box with padding past the chrome, at most zoom 9 unless asked', () => {
    showHeader();
    const map = fakeMap();
    flyMap(asMap(map), { kind: 'bounds', bbox: BOX });
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [-10, 40],
        [10, 60],
      ],
      { padding: { top: 120, bottom: 60, left: 60, right: 60 }, maxZoom: 9, duration: 1200 },
    );
    motion.isReduced = true;
    flyToBounds(asMap(map), { kind: 'bounds', bbox: BOX, maxZoom: 5 });
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ maxZoom: 5, duration: 0 }),
    );
  });
});

describe('flyToBounds with a centre', () => {
  it('flies to the centre at the zoom that fits the box, scaled for the centre’s latitude', () => {
    const map = fakeMap({ center: { lng: 0, lat: 50 }, zoom: 4 });
    flyToBounds(asMap(map), { kind: 'bounds', bbox: BOX, centre: [2, 10] });
    const zoom = 4 + zoomDrop(50) - zoomDrop(10);
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 10], zoom }));
  });

  it('reads a centre given as a pair, and never flies below the least zoom', () => {
    const map = fakeMap({ center: [0, 0], zoom: 1 });
    flyToBounds(asMap(map), { kind: 'bounds', bbox: BOX, centre: [0, 80] });
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 80], zoom: 1 }));
  });

  it('flies to the centre at the current zoom when the box has no camera', () => {
    for (const camera of [undefined, { center: [0, 0] as [number, number] }]) {
      const map = fakeMap(camera);
      flyToBounds(asMap(map), { kind: 'bounds', bbox: BOX, centre: [2, 10] });
      expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 10], zoom: 3 }));
    }
  });
});
