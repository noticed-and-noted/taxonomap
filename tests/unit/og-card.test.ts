/**
 * Open Graph species cards: rendered once with satori and resvg, then served
 * from the .cache/ copy. The cache lives in a temporary directory here.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsableImage } from '~/lib/gbif';

const repo = process.cwd();
let dir: string;

/** The module, with its cache directory under `dir`. */
async function load() {
  vi.resetModules();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  const module = await import('~/lib/og/species-card');
  cwd.mockRestore();
  return module;
}

/** The element tree handed to satori, with resvg stubbed. */
async function loadTree() {
  const trees: unknown[] = [];
  vi.doMock('satori', () => ({ default: async (element: unknown) => (trees.push(element), '<svg/>') }));
  vi.doMock('@resvg/resvg-js', () => ({
    Resvg: class {
      render = () => ({ asPng: () => Buffer.from('png') });
    },
  }));
  const module = await load();
  return { ...module, trees };
}

/** All the text in an element tree, in order. */
function texts(element: unknown): string[] {
  if (typeof element === 'string') return element ? [element] : [];
  if (Array.isArray(element)) return element.flatMap(texts);
  const props = (element as { props?: { children?: unknown } } | undefined)?.props;
  return props ? texts(props.children) : [];
}
const imgSrc = (element: unknown) =>
  (element as { props: { children: { props: { src?: string } }[] } }).props.children[0]!.props.src;

const BARE: UsableImage = { occurrenceKey: 1, datasetKey: 'd', licence: 'CC-BY', url: 'https://img.test/a.jpg' };
const PHOTO: UsableImage = { ...BARE, creator: 'Ann' };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'og-'));
  vi.spyOn(process, 'cwd').mockReturnValue(repo);
});
afterEach(async () => {
  vi.doUnmock('satori');
  vi.doUnmock('@resvg/resvg-js');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('renderSpeciesCard', () => {
  it('renders a 1200 × 630 PNG once, then serves the cached copy', async () => {
    const { renderSpeciesCard } = await load();
    const input = { commonName: 'European robin', scientificName: 'Erithacus rubecula', count: 11_000_000 };
    const png = await renderSpeciesCard(input);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(await readdir(join(dir, '.cache', 'og'))).toHaveLength(1);
    await expect(renderSpeciesCard(input)).resolves.toEqual(png);
  });

  it('lays out the names, count and initials when there is no photo', async () => {
    const { renderSpeciesCard, trees } = await loadTree();
    await renderSpeciesCard({ commonName: 'European robin', scientificName: 'Erithacus rubecula', count: 1234 });
    expect(texts(trees[0])).toEqual([
      'ER',
      'TAXONOMAP',
      'European robin',
      'Erithacus rubecula',
      '1.2K',
      'records on GBIF',
    ]);
    await renderSpeciesCard({ scientificName: 'Erithacus rubecula subsp. melophilus', count: 5 });
    // No common name: the scientific name is the (smaller, long) title, shown once.
    expect(texts(trees[1])).toEqual([
      'ER',
      'TAXONOMAP',
      'Erithacus rubecula subsp. melophilus',
      '5',
      'records on GBIF',
    ]);
  });

  it('downloads the photo once, credits it, and falls back to initials when it cannot', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes('/occurrence/1/')
        ? new Response('jpeg bytes', { headers: { 'content-type': 'image/jpeg; charset=binary' } })
        : url.includes('/occurrence/2/')
          ? new Response('<html>', { headers: { 'content-type': 'text/html' } })
          : url.includes('/occurrence/3/')
            ? new Response(null, { status: 404 })
            : url.includes('/occurrence/4/')
              ? new Response('bytes')
              : Promise.reject(new TypeError('offline')),
    );
    vi.stubGlobal('fetch', fetch);
    const { renderSpeciesCard, trees } = await loadTree();
    const card = (image: UsableImage, number = 1) =>
      renderSpeciesCard({ scientificName: `Species ${number}`, count: number, image });

    await card(PHOTO);
    expect(imgSrc(trees[0])).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg bytes').toString('base64')}`);
    expect(texts(trees[0]).at(-1)).toBe('Photo © Ann · CC-BY');
    // Another card with the same photo reads it from the cache.
    await card(PHOTO, 2);
    expect(imgSrc(trees[1])).toBe(imgSrc(trees[0]));
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('user-agent')).toMatch(/^Taxonomap\//);

    const others: UsableImage[] = [
      { ...BARE, occurrenceKey: 2, rightsHolder: 'Bo' },
      { ...BARE, occurrenceKey: 3 },
      { ...PHOTO, occurrenceKey: 4 },
      { ...PHOTO, occurrenceKey: 5 },
    ];
    for (const [index, image] of others.entries()) await card(image, index + 3);
    expect(trees.slice(2).map((tree) => imgSrc(tree))).toEqual([undefined, undefined, undefined, undefined]);
    expect(texts(trees[2]).at(-1)).toBe('Photo © Bo · CC-BY');
    expect(texts(trees[3]).at(-1)).toBe('Photo © unknown · CC-BY');
  });
});
