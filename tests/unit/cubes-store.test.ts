// @vitest-environment jsdom
/** The cube setting: off by default, remembered, and only possible when the build has cubes to read. */
import { cubeSet } from './helpers/cubes';
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

describe('openedCubes', () => {
  afterEach(() => vi.doUnmock('~/lib/cubes/reader'));

  it('gives the cubes once open, opening them the first time any page asks', async () => {
    const opened = cubeSet();
    const openCubes = vi.fn(async () => opened);
    vi.doMock('~/lib/cubes/reader', () => ({ openCubes }));
    const cubes = await store();
    const [first, second] = await Promise.all([cubes.openedCubes(), cubes.openedCubes()]);
    expect([first, second]).toEqual([opened, opened]);
    expect(cubes.$openCubes.get()).toBe(opened);
    expect(await cubes.openedCubes()).toBe(opened);
    expect(openCubes).toHaveBeenCalledTimes(1);
    expect(openCubes).toHaveBeenCalledWith('http://127.0.0.1:4324/pipeline/cubes/');
  });

  it('fails without cubes in the build, or when they can’t be read, and tries again next time', async () => {
    await expect((await store(null)).openedCubes()).rejects.toThrow('no cubes');
    const openCubes = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(cubeSet());
    vi.doMock('~/lib/cubes/reader', () => ({ openCubes }));
    const cubes = await store();
    await expect(cubes.openedCubes()).rejects.toThrow('offline');
    await expect(cubes.openedCubes()).resolves.toBeDefined();
  });
});
