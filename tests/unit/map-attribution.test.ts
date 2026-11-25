// @vitest-environment jsdom
/** The map's compact attribution: closed once its text arrives on a phone, and by a press outside it. */
import type { Map as MlMap } from 'maplibre-gl';
import { tameAttribution } from '~/lib/map/attribution';

const SHOWN = 'maplibregl-compact-show';

/** A stand-in map that keeps its `sourcedata` listeners so a test can fire them. */
function fakeMap() {
  const listeners = new Set<() => void>();
  return {
    fireSourceData: () => [...listeners].forEach((listener) => listener()),
    listenerCount: () => listeners.size,
    on: (_event: string, listener: () => void) => listeners.add(listener),
    off: (_event: string, listener: () => void) => listeners.delete(listener),
  };
}

/** A container holding an open attribution, with a link inside it. */
function containerWithAttribution() {
  const container = document.createElement('div');
  const attribution = document.createElement('details');
  attribution.className = `maplibregl-compact ${SHOWN}`;
  const link = document.createElement('a');
  attribution.append(link);
  container.append(attribution);
  document.body.append(container);
  return { container, attribution, link };
}

const press = (target: Element) => target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

afterEach(() => document.body.replaceChildren());

describe('tameAttribution', () => {
  it('on a phone, closes the attribution once its text arrives, then stops listening', () => {
    const map = fakeMap();
    const container = document.createElement('div');
    tameAttribution(map as unknown as MlMap, container, true);
    map.fireSourceData();
    expect(map.listenerCount()).toBe(1);
    const { container: withAttribution, attribution } = containerWithAttribution();
    container.append(...withAttribution.children);
    map.fireSourceData();
    expect(attribution.classList.contains(SHOWN)).toBe(false);
    expect(map.listenerCount()).toBe(0);
  });

  it('leaves the attribution open on a wider screen', () => {
    const map = fakeMap();
    const { container, attribution } = containerWithAttribution();
    tameAttribution(map as unknown as MlMap, container, false);
    map.fireSourceData();
    expect(attribution.classList.contains(SHOWN)).toBe(true);
  });

  it('closes on a press outside it, not inside it, until stopped', () => {
    const { container, attribution, link } = containerWithAttribution();
    const stop = tameAttribution(fakeMap() as unknown as MlMap, container, false);
    press(link);
    expect(attribution.classList.contains(SHOWN)).toBe(true);
    press(document.body);
    expect(attribution.classList.contains(SHOWN)).toBe(false);
    press(document.body);
    attribution.classList.add(SHOWN);
    stop();
    press(document.body);
    expect(attribution.classList.contains(SHOWN)).toBe(true);
  });
});
