import { Resvg } from '@resvg/resvg-js';
import type { APIRoute } from 'astro';
import appIcon from '../../../docs/brand/app-icon.svg?raw';

/** iOS and Android mask icons themselves, so those cuts drop the tile's own rounded corners. */
const fullBleed = appIcon.replace(/ rx="[\d.]+"/, '');

/** Shrinks the fern about the centre so it sits inside Android's maskable safe zone (a circle of 40% radius). */
const MASKABLE_SCALE = 0.85;
const maskableOffset = 32 * (1 - MASKABLE_SCALE);
const maskable = fullBleed
  .replace(/(<rect[^>]*\/>)/, `$1<g transform="translate(${maskableOffset} ${maskableOffset}) scale(${MASKABLE_SCALE})">`)
  .replace('</svg>', '</g></svg>');

const ICONS: Record<string, { svg: string; size: number }> = {
  'icon-192': { svg: appIcon, size: 192 },
  'icon-512': { svg: appIcon, size: 512 },
  'icon-maskable-512': { svg: maskable, size: 512 },
  'apple-touch-icon': { svg: fullBleed, size: 180 },
};

/** One PNG per icon cut, rendered from the app icon at build so they never drift from it. */
export function getStaticPaths() {
  return Object.keys(ICONS).map((name) => ({ params: { name } }));
}

/** PNG app icon for the web app manifest and iOS home screens. */
export const GET: APIRoute = ({ params }) => {
  const { svg, size } = ICONS[params['name']!]!;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
