// @vitest-environment jsdom
/** The cube setting: off by default, remembered, and only possible when the build has cubes to read. */
import { memoryStorage } from './helpers/storage';

/** A fresh copy of the store, in a build with cubes at `base` (null: none). */
async function store(base: string | null = 'http://127.0.0.1:4324/pipeline/cubes/') {
  vi.resetModules();
  vi.stubEnv('PUBLIC_CUBES_BASE', base ?? undefined);
  return import('~/stores/cubes');
}

const blockedStorage = () => {
  const blocked = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: blocked, setItem: blocked, removeItem: blocked };
};

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('cube setting store', () => {
  it('is off by default, and remembers being turned on and off again', async () => {
    const cubes = await store();
    expect(cubes.CUBES_BASE).toBe('http://127.0.0.1:4324/pipeline/cubes/');
    expect(cubes.$cubesOn.get()).toBe(false);
    cubes.setCubesOn(true);
    expect(cubes.$cubesOn.get()).toBe(true);
    expect((await store()).$cubesOn.get()).toBe(true);
    cubes.setCubesOn(false);
    expect(localStorage.getItem(cubes.CUBES_KEY)).toBeNull();
    expect((await store()).$cubesOn.get()).toBe(false);
  });

  it('stays off, whatever was saved, in a build without cubes', async () => {
    localStorage.setItem('map-cubes', 'on');
    const cubes = await store(null);
    expect(cubes.CUBES_BASE).toBeNull();
    expect(cubes.$cubesOn.get()).toBe(false);
    cubes.setCubesOn(true);
    expect(cubes.$cubesOn.get()).toBe(false);
  });

  it('stays off, and still changes for this page, when storage is blocked', async () => {
    vi.stubGlobal('localStorage', blockedStorage());
    const cubes = await store();
    expect(cubes.$cubesOn.get()).toBe(false);
    cubes.setCubesOn(true);
    expect(cubes.$cubesOn.get()).toBe(true);
  });

  it('is off when rendered on the server', async () => {
    vi.stubGlobal('window', undefined);
    expect((await store()).$cubesOn.get()).toBe(false);
  });
});
