// @vitest-environment jsdom
/** Reading preferences: their saved value and the <html> attributes they write. */
import { memoryStorage } from './helpers/storage';

async function store() {
  vi.resetModules();
  return import('~/stores/reading');
}

const root = () => document.documentElement;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  for (const name of root().getAttributeNames()) if (name.startsWith('data-')) root().removeAttribute(name);
});
afterEach(() => vi.unstubAllGlobals());

describe('reading store', () => {
  it('applies, saves and restores a change, keeping the other preferences', async () => {
    const reading = await store();
    reading.setReading({ textSize: 'larger', noItalics: true });
    reading.setReading({ wideSpacing: true });
    expect(root().dataset['textSize']).toBe('larger');
    expect(root().hasAttribute('data-no-italics')).toBe(true);
    expect(root().hasAttribute('data-wide-spacing')).toBe(true);

    const again = await store();
    expect(again.$reading.get()).toMatchObject({ textSize: 'larger', noItalics: true, wideSpacing: true });
  });

  it('removes the attributes when turned back off', async () => {
    const reading = await store();
    reading.setReading({ textSize: 'large', reduceMotion: true });
    reading.setReading({ textSize: 'normal', reduceMotion: false });
    expect(root().hasAttribute('data-text-size')).toBe(false);
    expect(root().hasAttribute('data-reduce-motion')).toBe(false);
  });

  it('ignores corrupt or unknown saved values', async () => {
    localStorage.setItem('reading', '{"textSize":"huge","reduceMotion":"yes"}');
    expect((await store()).$reading.get()).toEqual((await store()).DEFAULT_READING);
    localStorage.setItem('reading', 'null');
    expect((await store()).$reading.get()).toEqual((await store()).DEFAULT_READING);
    localStorage.setItem('reading', 'not json');
    expect((await store()).$reading.get().textSize).toBe('normal');
  });

  it('reduces motion when chosen even if the system does not ask', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const reading = await store();
    expect(reading.prefersReducedMotion()).toBe(false);
    reading.setReading({ reduceMotion: true });
    expect(reading.prefersReducedMotion()).toBe(true);
  });

  it('lighter rendering marks the page and skips animation', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const reading = await store();
    reading.setReading({ lightRendering: true });
    expect(root().hasAttribute('data-light-rendering')).toBe(true);
    expect(reading.prefersReducedMotion()).toBe(true);
  });
});
