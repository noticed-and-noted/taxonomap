/** The static endpoints under src/pages: robots.txt, the baked /data snapshots and the OG images. */
import type { APIContext } from 'astro';

const bake = {
  bakeNames: vi.fn(async () => ({ v: 1, generated: 'g', names: [] })),
  bakeSpeciesManifest: vi.fn(async () => ({ 10: 'species-10' })),
  bakeTree: vi.fn(async () => ({ v: 1, generated: 'g', nodes: [] })),
  bakeYears: vi.fn(async () => ({ v: 1, generated: 'g', total: 3, years: [[2000, 3]] })),
  bakeSpeciesList: vi.fn(async () => [
    { key: 10, slug: 'a', count: 5 },
    { key: 11, slug: 'b', count: 4 },
  ]),
  bakedCommonNames: vi.fn(async () => (key: number) => (key === 10 ? 'Robin' : null)),
};
const loadSpeciesData = vi.fn(async (key: number) => ({
  key,
  commonName: 'European robin',
  canonicalName: 'Erithacus rubecula',
  count: 42,
}));
const renderSpeciesCard = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
vi.mock('~/lib/bake', () => bake);
vi.mock('~/lib/species/data', () => ({ loadSpeciesData }));
vi.mock('~/lib/og/species-card', () => ({ renderSpeciesCard }));

const context = (partial: Partial<APIContext>) => partial as APIContext;

describe('robots.txt', () => {
  it('points at the sitemap on the site, or a relative one without a site', async () => {
    const { GET } = await import('~/pages/robots.txt');
    const withSite = await GET(context({ site: new URL('https://app.taxonomap.com') }));
    expect(withSite.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await withSite.text()).toBe(
      'User-agent: *\nAllow: /\nDisallow: /species/view\n\nSitemap: https://app.taxonomap.com/sitemap-index.xml\n',
    );
    expect(await (await GET(context({}))).text()).toContain('Sitemap: /sitemap-index.xml');
  });
});

describe('/data snapshots', () => {
  it.each([
    ['names', 'bakeNames'],
    ['species-manifest', 'bakeSpeciesManifest'],
    ['tree', 'bakeTree'],
    ['years', 'bakeYears'],
  ] as const)('/data/%s.json serves %s', async (name, callback) => {
    const { GET } = await import(`~/pages/data/${name}.json.ts`);
    const response: Response = await GET(context({}));
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(await bake[callback]());
  });
});

describe('/og/species/[key].png', () => {
  it('is built for every pre-rendered species', async () => {
    const { getStaticPaths } = await import('~/pages/og/species/[key].png');
    await expect(getStaticPaths()).resolves.toEqual([{ params: { key: '10' } }, { params: { key: '11' } }]);
  });

  it('renders the card from the species data, named from the baked index', async () => {
    const { GET } = await import('~/pages/og/species/[key].png');
    const response = await GET(context({ params: { key: '10' } }));
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(loadSpeciesData).toHaveBeenCalledWith(10, expect.any(Function));
    expect(renderSpeciesCard).toHaveBeenCalledWith({
      commonName: 'European robin',
      scientificName: 'Erithacus rubecula',
      count: 42,
    });
  });
});
