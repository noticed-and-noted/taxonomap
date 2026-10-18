/** Small shared helpers: basemaps, env, country names, the ramp's colours and counts. */
import { countryName } from '~/lib/format';
import { binLabels, formatCount, nice, rampById, rampColors, RAMPS } from '~/lib/ramp';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('basemaps', () => {
  it('uses the keyless defaults', async () => {
    const { BASEMAPS, BASEMAP_IDS } = await import('~/lib/basemaps');
    expect(BASEMAP_IDS).toEqual(['plain', 'terrain', 'satellite']);
    expect(BASEMAPS.plain.source('dark')).toEqual({
      kind: 'vector',
      styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    });
    expect(BASEMAPS.plain.source('light')).toEqual({
      kind: 'vector',
      styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    });
    expect(BASEMAPS.terrain.source('dark')).toMatchObject({
      kind: 'raster',
      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    });
    expect(BASEMAPS.satellite.source('dark')).toMatchObject({
      kind: 'raster',
      maxzoom: 15,
      tiles: [expect.stringContaining('eox.at')],
    });
  });

  it('takes overrides from PUBLIC_BASEMAP_*', async () => {
    vi.stubEnv('PUBLIC_BASEMAP_PLAIN_DARK', 'https://dark.test');
    vi.stubEnv('PUBLIC_BASEMAP_PLAIN_LIGHT', 'https://light.test');
    vi.stubEnv('PUBLIC_BASEMAP_TERRAIN', 'https://terrain.test/{z}/{x}/{y}');
    vi.stubEnv('PUBLIC_BASEMAP_SATELLITE', 'https://sat.test/{z}/{x}/{y}');
    const { BASEMAPS } = await import('~/lib/basemaps');
    expect(BASEMAPS.plain.source('dark')).toMatchObject({ styleUrl: 'https://dark.test' });
    expect(BASEMAPS.plain.source('light')).toMatchObject({ styleUrl: 'https://light.test' });
    expect(BASEMAPS.terrain.source('light')).toMatchObject({ tiles: ['https://terrain.test/{z}/{x}/{y}'] });
    expect(BASEMAPS.satellite.source('light')).toMatchObject({ tiles: ['https://sat.test/{z}/{x}/{y}'] });
  });
});

describe('env', () => {
  it('merges process.env with Vite’s env', async () => {
    vi.stubEnv('SOME_TEST_VAR', 'x');
    const { env, isDev } = await import('~/lib/env');
    expect(env['SOME_TEST_VAR']).toBe('x');
    // Vitest runs Vite in dev mode.
    expect(isDev()).toBe(true);
  });
});

describe('countryName', () => {
  it('falls back to the code when the display name is missing', async () => {
    const spy = vi.spyOn(Intl, 'DisplayNames').mockImplementation(
      class {
        of = () => undefined;
      } as never,
    );
    const { countryName: fresh } = await import('~/lib/format');
    expect(fresh('gb')).toBe('gb');
    spy.mockRestore();
    expect(countryName('fr')).toBe('France');
  });
});

describe('ramp', () => {
  it('reads the colours from the --ramp-* tokens, defaulting each', () => {
    // A page whose stylesheet sets only the first token.
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (p: string) => (p === '--ramp-1' ? ' #123456 ' : ''),
    }));
    const colors = rampColors();
    expect(colors).toHaveLength(7);
    expect(colors[0]).toBe('#123456');
    expect(colors[1]).toBe(rampById('lichen-fern').colors[2]);
  });

  it('uses the default ramp’s colours without a document', () => {
    expect(rampColors()).toEqual(rampById('lichen-fern').colors.slice(1));
  });

  it('falls back to the first ramp for an unknown id', () => {
    expect(rampById('nope' as never)).toBe(RAMPS[0]);
  });

  it('rounds up to the next power of ten and shortens billions', () => {
    expect(nice(8)).toBe(10);
    expect(formatCount(2e9)).toBe('2B');
    expect(formatCount(3e6)).toBe('3M');
    expect(binLabels(0).at(-1)).toBe('5B');
  });
});
