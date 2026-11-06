/** The service worker the build writes: what it precaches and how it caches each kind of request. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { generateSW } from 'workbox-build';

type SwConfig = Parameters<typeof generateSW>[0];
type Rule = NonNullable<SwConfig['runtimeCaching']>[number];
type Plugin = Record<string, (...args: never[]) => Promise<unknown>>;

const generated = vi.hoisted(() => ({ configs: [] as SwConfig[], warnings: [] as string[] }));

vi.mock('workbox-build', () => ({
  generateSW: async (config: SwConfig) => {
    generated.configs.push(config);
    return { count: 3, size: 4096, warnings: generated.warnings, filePaths: [] };
  },
}));

let outDir: string;

/** Runs the integration's build hook over a fresh output folder, and returns the config it gave Workbox. */
async function build({ hasOfflinePage = true, env = {} as Record<string, string> } = {}) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  if (hasOfflinePage) {
    mkdirSync(join(outDir, 'offline'), { recursive: true });
    writeFileSync(join(outDir, 'offline/index.html'), '');
  }
  const logger = { info: vi.fn(), warn: vi.fn() };
  const { default: serviceWorker } = await import('../../integrations/service-worker');
  const hook = serviceWorker().hooks['astro:build:done'] as (options: object) => Promise<void>;
  await hook({ dir: pathToFileURL(`${outDir}/`), logger });
  return { config: generated.configs.at(-1)!, logger };
}

/** The rule Workbox would pick for a request: the first whose pattern matches. */
function ruleFor(config: SwConfig, url: string, request: Partial<Request> = {}): Rule | undefined {
  const parsed = new URL(url);
  const sameOrigin = parsed.origin === 'https://app.test';
  return config.runtimeCaching!.find(({ urlPattern }) =>
    urlPattern instanceof RegExp
      ? urlPattern.test(url)
      : (urlPattern as (context: object) => boolean)({ url: parsed, sameOrigin, request }),
  );
}

const pluginOf = (rule: Rule | undefined) => rule!.options!.plugins![0] as unknown as Plugin;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'sw-'));
  generated.configs = [];
  generated.warnings = [];
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('service worker', () => {
  it('precaches the offline page under the URL Pages serves it at, and logs what it wrote', async () => {
    generated.warnings = ['big file'];
    const { config, logger } = await build();
    expect(config.swDest).toBe(`${outDir}//sw.js`);
    expect(config.globPatterns?.[0]).toBe('offline/index.html');
    const transform = config.manifestTransforms![0]!;
    const entries = [
      { url: 'offline/index.html', revision: '1', size: 1 },
      { url: 'about.html', revision: '1', size: 1 },
      { url: '_astro/app.js', revision: null, size: 1 },
    ];
    const { manifest } = await transform(entries);
    expect(manifest.map((entry) => entry.url)).toEqual(['/offline/', '/about', '/_astro/app.js']);
    expect(logger.warn).toHaveBeenCalledWith('big file');
    expect(logger.info).toHaveBeenCalledWith('sw.js: precached 3 files (4 KB)');
  });

  it('leaves the offline page out when the build has none', async () => {
    const { config } = await build({ hasOfflinePage: false });
    expect(config.globPatterns).not.toContain('offline/index.html');
  });

  it('picks a strategy for each kind of request', async () => {
    const { config } = await build();
    const handler = (url: string, request?: Partial<Request>) => ruleFor(config, url, request)?.handler;
    expect(handler('https://app.test/data/species-manifest.json')).toBe('NetworkFirst');
    expect(handler('https://app.test/data/names.json')).toBe('StaleWhileRevalidate');
    expect(handler('https://app.test/species/robin', { mode: 'navigate' })).toBe('NetworkOnly');
    expect(handler('https://api.gbif.org/v2/map/occurrence/density/0/0/0@1x.png')).toBe('CacheFirst');
    expect(ruleFor(config, 'https://api.gbif.org/v1/occurrence/search')?.options?.cacheName).toBe('gbif-json');
    expect(ruleFor(config, 'https://api.gbif.org/v1/image/unsafe/x')).toBeUndefined();
    expect(ruleFor(config, 'https://graphql.gbif.org/graphql?query=x')?.options?.cacheName).toBe('gbif-graphql');
    expect(ruleFor(config, 'https://tiles.openfreemap.org/styles/x')?.options?.cacheName).toBe('basemap');
    const image = ruleFor(config, 'https://photos.test/a.jpg', { destination: 'image' });
    expect(image?.options?.cacheName).toBe('images');
    expect(ruleFor(config, 'https://elsewhere.test/a.js', { destination: 'script' })).toBeUndefined();
  });

  it('points GBIF rules at the configured hosts, without trailing slashes', async () => {
    const { config } = await build({
      env: {
        PUBLIC_GBIF_API_BASE: 'https://gbif.test/',
        PUBLIC_GBIF_TILE_BASE: 'https://tiles.test//',
        PUBLIC_GBIF_GRAPHQL_BASE: 'https://gql.test/',
      },
    });
    expect(ruleFor(config, 'https://tiles.test/v2/map/x.mvt?style=y')?.options?.cacheName).toBe('gbif-tiles');
    expect(ruleFor(config, 'https://gbif.test/v1/species/1')?.options?.cacheName).toBe('gbif-json');
    expect(ruleFor(config, 'https://gql.test/graphql?query=x')?.options?.cacheName).toBe('gbif-graphql');
  });

  it('never caches a GraphQL answer with errors, or one that is not JSON', async () => {
    const { config } = await build();
    const { cacheWillUpdate } = pluginOf(ruleFor(config, 'https://graphql.gbif.org/graphql?q'));
    const willCache = (body: string) =>
      (cacheWillUpdate as never as (options: object) => Promise<unknown>)({
        response: new Response(body),
      });
    expect(await willCache('{"data":{}}')).toBeInstanceOf(Response);
    expect(await willCache('{"errors":[{}]}')).toBeNull();
    expect(await willCache('<html>')).toBeNull();
  });

  it('refetches an opaque copy for a CORS image, and serves it otherwise', async () => {
    const { config } = await build();
    const { cachedResponseWillBeUsed } = pluginOf(ruleFor(config, 'https://tiles.maps.eox.at/x'));
    const use = cachedResponseWillBeUsed as never as (options: object) => Promise<unknown>;
    const opaque = { type: 'opaque' };
    expect(await use({ request: { mode: 'cors' }, cachedResponse: opaque })).toBeNull();
    expect(await use({ request: { mode: 'no-cors' }, cachedResponse: opaque })).toBe(opaque);
    expect(await use({ request: { mode: 'cors' } })).toBeUndefined();
  });
});
