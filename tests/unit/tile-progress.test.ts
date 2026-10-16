import { describe, expect, it } from 'vitest';
import { createTileProgress, type TileLike } from '~/lib/map/tileProgress';

const tile = (state = 'loading'): TileLike => ({ state });

describe('createTileProgress', () => {
  it('counts started and settled tiles', () => {
    const p = createTileProgress();
    const a = tile();
    const b = tile();
    p.start(a);
    p.start(b);
    expect(p.get()).toEqual({ done: 0, total: 2 });
    a.state = 'loaded';
    p.settle(a);
    expect(p.get()).toEqual({ done: 1, total: 2 });
  });

  it('ignores a tile started twice', () => {
    const p = createTileProgress();
    const a = tile();
    p.start(a);
    p.start(a);
    expect(p.get().total).toBe(1);
  });

  it('picks up tiles that settled without their own event (404s, aborts)', () => {
    const p = createTileProgress();
    const missing = tile();
    const aborted = tile();
    const live = tile();
    [missing, aborted, live].forEach(p.start);
    missing.state = 'errored';
    aborted.aborted = true;
    p.settle();
    expect(p.get()).toEqual({ done: 2, total: 3 });
  });

  it('resets when the burst ends', () => {
    const p = createTileProgress();
    p.start(tile());
    p.reset();
    expect(p.get()).toEqual({ done: 0, total: 0 });
  });
});
