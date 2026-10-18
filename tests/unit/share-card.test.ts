/**
 * The Near me share card: text first, then the basemap and density tiles
 * around the area, then the radius ring. The canvas and images are fakes
 * that record what is drawn.
 */
import { canvasToBlob, drawShareCard, type ShareCardInput } from '~/lib/near/share-card';

/** A 2D context that records calls; text is 20 px a character wide. */
function fakeContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 20 });
      return (...args: unknown[]) => void calls.push({ name: prop, args });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  return { ctx, calls, texts: () => calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]) };
}

function fakeCanvas(ctx: unknown) {
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

/** Images that load, fail or never answer, by URL. */
function fakeImages(outcome: (src: string) => 'load' | 'error' | 'hang') {
  const srcs: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        srcs.push(v);
        const o = outcome(v);
        if (o === 'load') queueMicrotask(() => this.onload?.());
        if (o === 'error') queueMicrotask(() => this.onerror?.());
      }
    },
  );
  return srcs;
}

const INPUT: ShareCardInput = {
  count: 1234,
  groupLabel: 'Bird species',
  radiusKm: 2,
  lat: 51.5,
  lng: -0.12,
  topNames: ['European robin', 'House sparrow', 'Blue tit', 'Wren'],
  month: 'October',
  theme: 'dark',
  taxonKey: 212,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('drawShareCard', () => {
  it('writes the count, headline and top names, then draws nine basemap and density tiles and the ring', async () => {
    const srcs = fakeImages(() => 'load');
    const { ctx, calls, texts } = fakeContext();
    const canvas = fakeCanvas(ctx);
    await drawShareCard(canvas, INPUT);
    expect([canvas.width, canvas.height]).toEqual([1200, 630]);
    expect(texts()).toEqual([
      'TAXONOMAP · WHAT’S NEAR ME',
      '1,234',
      'Bird species recorded',
      'within 2 km in October',
      'Including European robin ·',
      'House sparrow · Blue tit',
      'Occurrence data: GBIF.org · area ~2 km radius',
    ]);
    expect([ctx['fillStyle'], ctx['strokeStyle']]).toEqual(['#14221b', '#f0b443']);
    expect(srcs.filter((s) => s.startsWith('https://tile.gbif.org/'))).toHaveLength(9);
    const density = srcs.filter((s) => s.includes('/v2/map/occurrence/'));
    expect(density).toHaveLength(9);
    expect(density[0]).toContain('taxonKey=212');
    expect(calls.filter((c) => c.name === 'drawImage')).toHaveLength(18);
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(1);
  });

  it('uses the light palette, and leaves out a missing month and names', async () => {
    fakeImages(() => 'error');
    const { ctx, calls, texts } = fakeContext();
    await drawShareCard(fakeCanvas(ctx), {
      ...INPUT,
      theme: 'light',
      month: undefined,
      topNames: [],
      groupLabel: 'Species',
    });
    expect(texts()).toContain('Species recorded within 2');
    expect(texts().some((t) => String(t).startsWith('Including'))).toBe(false);
    expect(ctx['strokeStyle']).toBe('#9c5200');
    // No image loaded: nothing drawn but the ring.
    expect(calls.filter((c) => c.name === 'drawImage')).toHaveLength(0);
  });

  it('gives up on a tile after five seconds, and draws no rows off the map', async () => {
    vi.useFakeTimers();
    const srcs = fakeImages((s) => (s.includes('tile.gbif.org') ? 'hang' : 'load'));
    const { ctx, calls } = fakeContext();
    // At the top row the row above is off the map; at the bottom, the row below.
    const top = drawShareCard(fakeCanvas(ctx), { ...INPUT, lat: 85, radiusKm: 50 });
    await vi.advanceTimersByTimeAsync(5000);
    await top;
    expect(srcs).toHaveLength(12);
    const bottom = drawShareCard(fakeCanvas(ctx), { ...INPUT, lat: -85, radiusKm: 50 });
    await vi.advanceTimersByTimeAsync(5000);
    await bottom;
    expect(calls.filter((c) => c.name === 'arc').length).toBeGreaterThanOrEqual(2);
  });

  it('stops drawing once a newer draw cancels it', async () => {
    fakeImages(() => 'load');
    const { ctx, calls } = fakeContext();
    const token = { cancelled: false };
    const draw = drawShareCard(fakeCanvas(ctx), INPUT, token);
    token.cancelled = true;
    await draw;
    expect(calls.filter((c) => c.name === 'drawImage' || c.name === 'arc')).toHaveLength(0);
    expect(calls.at(-1)!.name).toBe('restore');
  });

  it('does nothing without a 2D context, and wraps a word too long for a line on its own', async () => {
    const srcs = fakeImages(() => 'load');
    await drawShareCard(fakeCanvas(null), INPUT);
    expect(srcs).toHaveLength(0);
    const { ctx, texts } = fakeContext();
    await drawShareCard(fakeCanvas(ctx), {
      ...INPUT,
      groupLabel: 'Supercalifragilisticexpialidocious',
      month: undefined,
    });
    expect(texts()).toContain('Supercalifragilisticexpialidocious');
  });
});

describe('canvasToBlob', () => {
  it('resolves the PNG, or null for a tainted canvas', async () => {
    const blob = new Blob(['png']);
    const ok = { toBlob: (cb: (b: Blob) => void, type: string) => (expect(type).toBe('image/png'), cb(blob)) };
    await expect(canvasToBlob(ok as unknown as HTMLCanvasElement)).resolves.toBe(blob);
    const tainted = {
      toBlob: () => {
        throw new DOMException('Tainted canvases may not be exported', 'SecurityError');
      },
    };
    await expect(canvasToBlob(tainted as unknown as HTMLCanvasElement)).resolves.toBeNull();
  });
});
