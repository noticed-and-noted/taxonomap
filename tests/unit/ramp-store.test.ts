// @vitest-environment jsdom
/** The density-ramp choice: its catalogue, its saved value and the tokens it writes. */
import { DEFAULT_RAMP, RAMPS, isRampId, rampById } from '~/lib/ramp';

async function store() {
  vi.resetModules();
  return import('~/stores/ramp');
}

const token = (i: number) => document.documentElement.style.getPropertyValue(`--ramp-${i}`);

// Newer Node ships its own localStorage global, which shadows jsdom's; stub a plain one.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  document.documentElement.removeAttribute('style');
});
afterEach(() => vi.unstubAllGlobals());

describe('a blocked storage', () => {
  it('falls back to the default ramp when it cannot be read', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    const { $ramp } = await store();
    expect($ramp.get()).toBe(DEFAULT_RAMP);
  });
});

describe('ramp catalogue', () => {
  it('gives every ramp a unique id and eight hex stops', () => {
    expect(new Set(RAMPS.map((r) => r.id)).size).toBe(RAMPS.length);
    for (const r of RAMPS) {
      expect(r.colors).toHaveLength(8);
      for (const c of r.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('defaults to lichen to fern and rejects unknown ids', () => {
    expect(DEFAULT_RAMP).toBe('lichen-fern');
    expect(isRampId('magma')).toBe(true);
    expect(isRampId('rainbow')).toBe(false);
    expect(isRampId(null)).toBe(false);
    expect(rampById(DEFAULT_RAMP).name).toBe('Lichen to fern');
  });

  it('keeps the tokens.css default in step with the default ramp', async () => {
    const { readFile } = await import('node:fs/promises');
    const css = await readFile('src/styles/tokens.css', 'utf8');
    rampById(DEFAULT_RAMP).colors.forEach((c, i) => expect(css).toContain(`--ramp-${i}: ${c};`));
  });
});

describe('ramp store', () => {
  it('starts on the default and writes no overrides', async () => {
    const s = await store();
    expect(s.$ramp.get()).toBe(DEFAULT_RAMP);
    expect(token(1)).toBe('');
  });

  it('applies, saves and restores a chosen ramp', async () => {
    const s = await store();
    s.setRamp('magma');
    expect(s.$ramp.get()).toBe('magma');
    expect(token(1)).toBe(rampById('magma').colors[1]);
    expect(localStorage.getItem(s.RAMP_KEY)).toBe('magma');

    document.documentElement.removeAttribute('style');
    const again = await store();
    expect(again.$ramp.get()).toBe('magma');
    expect(token(7)).toBe(rampById('magma').colors[7]);
  });

  it('sets the tokens before listeners hear about the change', async () => {
    const s = await store();
    let seen = '';
    s.$ramp.listen(() => (seen = token(4)));
    s.setRamp('bamako');
    expect(seen).toBe(rampById('bamako').colors[4]);
  });

  it('going back to the default clears the overrides and the saved value', async () => {
    const s = await store();
    s.setRamp('mako');
    s.setRamp(DEFAULT_RAMP);
    expect(token(1)).toBe('');
    expect(localStorage.getItem(s.RAMP_KEY)).toBeNull();
  });

  it('ignores a saved id it does not know', async () => {
    localStorage.setItem('map-colours', 'rainbow');
    const s = await store();
    expect(s.$ramp.get()).toBe(DEFAULT_RAMP);
  });

  it('re-applies the choice after a ClientRouter swap', async () => {
    const s = await store();
    s.setRamp('plasma');
    document.documentElement.removeAttribute('style');
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(token(2)).toBe(rampById('plasma').colors[2]);
  });
});
