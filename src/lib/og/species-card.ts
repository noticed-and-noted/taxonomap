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
import { thumbnailUrl, type UsableImage } from '~/lib/gbif';
import { userAgent } from '~/lib/gbif/node-transport';

const WIDTH = 1200;
const HEIGHT = 630;
const VERSION = 2; // bump to re-render every card
const CACHE = join(process.cwd(), '.cache');

export interface SpeciesCardInput {
  commonName?: string | undefined;
  scientificName: string;
  count: number;
  image?: UsableImage | undefined;
}

type El = { type: string; props: Record<string, unknown> };
const element = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  extra: Record<string, unknown> = {},
): El => ({
  type,
  props: { style, children, ...extra },
});

/** Fonts for satori, read from the installed @fontsource packages once. */
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600; style: 'normal' | 'italic' }[]> | undefined;
/** The dark-theme fern from docs/brand, as a data URI, read once. */
let fernMark: Promise<string> | undefined;
function loadFonts() {
  const fontFile = (packageName: string, file: string) =>
    readFile(join(process.cwd(), 'node_modules', packageName, 'files', file));
  fonts ??= Promise.all([
    fontFile('@fontsource/lexend', 'lexend-latin-400-normal.woff').then((data) => ({
      name: 'Lexend',
      data,
      weight: 400 as const,
      style: 'normal' as const,
    })),
    fontFile('@fontsource/lexend', 'lexend-latin-600-normal.woff').then((data) => ({
      name: 'Lexend',
      data,
      weight: 600 as const,
      style: 'normal' as const,
    })),
    fontFile('@fontsource/source-serif-4', 'source-serif-4-latin-600-normal.woff').then((data) => ({
      name: 'Serif',
      data,
      weight: 600 as const,
      style: 'normal' as const,
    })),
    fontFile('@fontsource/source-serif-4', 'source-serif-4-latin-400-italic.woff').then((data) => ({
      name: 'Serif',
      data,
      weight: 400 as const,
      style: 'italic' as const,
    })),
    fontFile('@fontsource/patrick-hand', 'patrick-hand-latin-400-normal.woff').then((data) => ({
      name: 'Hand',
      data,
      weight: 400 as const,
      style: 'normal' as const,
    })),
  ]);
  return fonts;
}

function loadFernMark() {
  fernMark ??= readFile(join(process.cwd(), 'docs', 'brand', 'fern-mark-dark.svg')).then(
    (svg) => `data:image/svg+xml;base64,${svg.toString('base64')}`,
  );
  return fernMark;
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/** Download (once) a photo as a data URI; null if unavailable. */
async function photoDataUri(image: UsableImage): Promise<string | null> {
  const url = thumbnailUrl(image, '800x');
  const file = join(CACHE, 'og-photos', `${sha1(url)}.bin`);
  try {
    const buffer = await readFile(file);
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch {
    /* not cached */
  }
  try {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent() } });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !/image\/(jpeg|png)/.test(type)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(join(CACHE, 'og-photos'), { recursive: true });
    await writeFile(file, buffer);
    return `data:${type.split(';')[0]};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Satori cannot read CSS variables, so these mirror the dark theme in src/styles/tokens.css. */
const COLOURS = {
  bg: '#0e1813',
  text: '#f2ede2',
  muted: '#a8b8ae',
  subtle: '#93a79b',
  ramp4: '#6fab6f',
};
const PHOTO_SIZE = 630;
const TEXT_PANEL_WIDTH = WIDTH - PHOTO_SIZE;
const LONG_TITLE_LENGTH = 24;
const INITIALS_COUNT = 2;
const WORDMARK_SIZE = 40;
/*
 * The fern as the first "o", sized as Wordmark.astro does (0.474em wide over its 32-unit viewBox). The brand
 * file's viewBox is 40×56 units starting 2 units further left and up, and ending 6 right and 1 lower, so
 * margins and drop absorb the difference to keep the coil in the same place.
 */
const FERN_EM_PER_UNIT = 0.474 / 32;
const fernStyle = (fontSize: number) => ({
  width: 40 * FERN_EM_PER_UNIT * fontSize,
  height: 56 * FERN_EM_PER_UNIT * fontSize,
  marginLeft: (0.02 - 2 * FERN_EM_PER_UNIT) * fontSize,
  marginRight: (0.02 - 6 * FERN_EM_PER_UNIT) * fontSize,
  transform: `translateY(${(0.308 + FERN_EM_PER_UNIT) * fontSize}px)`,
});

/** The taxonomap wordmark: lowercase Patrick Hand with the fern as the first "o". */
function wordmark(fern: string): El {
  return element(
    'div',
    { display: 'flex', alignItems: 'baseline', fontFamily: 'Hand', fontSize: WORDMARK_SIZE, marginBottom: 24 },
    [
      element('div', {}, 'tax'),
      element('img', fernStyle(WORDMARK_SIZE), undefined, { src: fern }),
      element('div', {}, 'nomap'),
    ],
  );
}

/** The card's left half: the photo, or the name's initials on a flat ramp-coloured tile when there is none. */
function photoPanel(title: string, photo: string | null): El {
  if (photo) {
    return element('img', { width: PHOTO_SIZE, height: PHOTO_SIZE, objectFit: 'cover' }, undefined, {
      src: photo,
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
    });
  }
  const initials = title
    .split(/\s+/)
    .slice(0, INITIALS_COUNT)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  return element(
    'div',
    {
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: COLOURS.ramp4,
      fontFamily: 'Serif',
      fontSize: 160,
      color: COLOURS.bg,
    },
    initials,
  );
}

/** The names block: title, with the scientific name beneath when the title is a common name. */
function namesBlock(input: SpeciesCardInput, title: string, fern: string): El {
  const scientificName = input.commonName
    ? element(
        'div',
        { fontFamily: 'Serif', fontStyle: 'italic', fontSize: 34, color: COLOURS.muted, marginTop: 14 },
        input.scientificName,
      )
    : element('div', {}, '');
  return element('div', { display: 'flex', flexDirection: 'column' }, [
    wordmark(fern),
    element(
      'div',
      {
        fontFamily: 'Serif',
        fontWeight: input.commonName ? 600 : 400,
        // Latin binomials are always italic; the italic is only loaded at 400.
        fontStyle: input.commonName ? 'normal' : 'italic',
        fontSize: title.length > LONG_TITLE_LENGTH ? 54 : 66,
        lineHeight: 1.05,
      },
      title,
    ),
    scientificName,
  ]);
}

/** The card's right half: wordmark and names above, record count and photo credit below. */
function textPanel(input: SpeciesCardInput, title: string, fern: string): El {
  const credit = input.image
    ? `Photo © ${input.image.creator ?? input.image.rightsHolder ?? 'unknown'} · ${input.image.licence}`
    : '';
  return element(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: TEXT_PANEL_WIDTH,
      padding: '56px 52px',
      justifyContent: 'space-between',
    },
    [
      namesBlock(input, title, fern),
      element('div', { display: 'flex', flexDirection: 'column' }, [
        element('div', { display: 'flex', alignItems: 'baseline' }, [
          element('div', { fontSize: 64, fontWeight: 600 }, compact(input.count)),
          element('div', { fontSize: 26, color: COLOURS.muted, marginLeft: 14 }, 'records on GBIF'),
        ]),
        element('div', { fontSize: 17, color: COLOURS.subtle, marginTop: 18 }, credit),
      ]),
    ],
  );
}

/** The card's element tree: photo on the left, text on the right. */
function card(input: SpeciesCardInput, photo: string | null, fern: string): El {
  const title = input.commonName ?? input.scientificName;
  return element(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      display: 'flex',
      background: COLOURS.bg,
      color: COLOURS.text,
      fontFamily: 'Lexend',
    },
    [photoPanel(title, photo), textPanel(input, title, fern)],
  );
}

/**
 * The species' Open Graph card as PNG bytes, from the disk cache when the content is unchanged.
 * @param input Names, record count and optional lead photo to draw.
 * @returns The 1200×630 PNG.
 */
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
  const svg = await satori(card(input, photo, await loadFernMark()) as unknown as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: await loadFonts(),
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
  await mkdir(join(CACHE, 'og'), { recursive: true });
  await writeFile(file, png);
  return png;
}
