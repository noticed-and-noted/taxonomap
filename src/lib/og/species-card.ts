/**
 * Open Graph image for a species (1200×630 PNG), rendered at build with
 * satori → SVG → resvg. Node only. Photos and rendered PNGs are cached in
 * .cache/ so nightly builds only re-render what changed.
 */
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';
import { compact } from '~/lib/format';
import { GBIF_FALLBACK_BASE, thumbnailUrl, type UsableImage } from '~/lib/gbif';
import { userAgent } from '~/lib/gbif/node-transport';

const W = 1200;
const H = 630;
const VERSION = 1; // bump to re-render every card
const CACHE = join(process.cwd(), '.cache');

export interface SpeciesCardInput {
  commonName?: string | undefined;
  scientificName: string;
  count: number;
  image?: UsableImage | undefined;
}

type El = { type: string; props: Record<string, unknown> };
const h = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  extra: Record<string, unknown> = {},
): El => ({
  type,
  props: { style, children, ...extra },
});

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600; style: 'normal' | 'italic' }[]> | undefined;
function loadFonts() {
  const f = (pkg: string, file: string) => readFile(join(process.cwd(), 'node_modules', pkg, 'files', file));
  fonts ??= Promise.all([
    f('@fontsource/inter', 'inter-latin-400-normal.woff').then((data) => ({
      name: 'Inter',
      data,
      weight: 400 as const,
      style: 'normal' as const,
    })),
    f('@fontsource/inter', 'inter-latin-600-normal.woff').then((data) => ({
      name: 'Inter',
      data,
      weight: 600 as const,
      style: 'normal' as const,
    })),
    f('@fontsource/source-serif-4', 'source-serif-4-latin-600-normal.woff').then((data) => ({
      name: 'Serif',
      data,
      weight: 600 as const,
      style: 'normal' as const,
    })),
    f('@fontsource/source-serif-4', 'source-serif-4-latin-400-italic.woff').then((data) => ({
      name: 'Serif',
      data,
      weight: 400 as const,
      style: 'italic' as const,
    })),
  ]);
  return fonts;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** Download (once) a photo as a data URI; null if unavailable. */
async function photoDataUri(img: UsableImage): Promise<string | null> {
  const url = thumbnailUrl(img, '800x', GBIF_FALLBACK_BASE);
  const file = join(CACHE, 'og-photos', `${sha1(url)}.bin`);
  try {
    const buf = await readFile(file);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    /* not cached */
  }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent() } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/image\/(jpeg|png)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(join(CACHE, 'og-photos'), { recursive: true });
    await writeFile(file, buf);
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function card(input: SpeciesCardInput, photo: string | null): El {
  const title = input.commonName ?? input.scientificName;
  const credit = input.image
    ? `Photo © ${input.image.creator ?? input.image.rightsHolder ?? 'unknown'} · ${input.image.licence}`
    : '';
  return h(
    'div',
    { width: W, height: H, display: 'flex', background: '#0e1813', color: '#e9f0ea', fontFamily: 'Inter' },
    [
      photo
        ? h('img', { width: 630, height: 630, objectFit: 'cover' }, undefined, { src: photo, width: 630, height: 630 })
        : h(
            'div',
            {
              width: 630,
              height: 630,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #277f8e, #1fa187 50%, #a0da39)',
              fontFamily: 'Serif',
              fontSize: 160,
              color: '#0e1813',
            },
            title
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join(''),
          ),
      h(
        'div',
        { display: 'flex', flexDirection: 'column', width: 570, padding: '56px 52px', justifyContent: 'space-between' },
        [
          h('div', { display: 'flex', flexDirection: 'column' }, [
            h('div', { fontSize: 22, color: '#f0b443', letterSpacing: 1, marginBottom: 28 }, 'TAXONOMAP'),
            h(
              'div',
              { fontFamily: 'Serif', fontWeight: 600, fontSize: title.length > 24 ? 54 : 66, lineHeight: 1.05 },
              title,
            ),
            input.commonName
              ? h(
                  'div',
                  { fontFamily: 'Serif', fontStyle: 'italic', fontSize: 34, color: '#a9bbb0', marginTop: 14 },
                  input.scientificName,
                )
              : h('div', {}, ''),
          ]),
          h('div', { display: 'flex', flexDirection: 'column' }, [
            h('div', { display: 'flex', alignItems: 'baseline' }, [
              h('div', { fontSize: 64, fontWeight: 600 }, compact(input.count)),
              h('div', { fontSize: 26, color: '#a9bbb0', marginLeft: 14 }, 'records on GBIF'),
            ]),
            h('div', { fontSize: 17, color: '#84998c', marginTop: 18 }, credit),
          ]),
        ],
      ),
    ],
  );
}

export async function renderSpeciesCard(input: SpeciesCardInput): Promise<Buffer> {
  const cacheKey = sha1(
    JSON.stringify({
      v: VERSION,
      n: input.commonName,
      s: input.scientificName,
      c: compact(input.count),
      i: input.image?.url,
    }),
  );
  const file = join(CACHE, 'og', `${cacheKey}.png`);
  try {
    return await readFile(file);
  } catch {
    /* render */
  }
  const photo = input.image ? await photoDataUri(input.image) : null;
  const svg = await satori(card(input, photo) as unknown as Parameters<typeof satori>[0], {
    width: W,
    height: H,
    fonts: await loadFonts(),
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  await mkdir(join(CACHE, 'og'), { recursive: true });
  await writeFile(file, png);
  return png;
}
