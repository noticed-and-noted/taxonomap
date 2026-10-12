import type { APIRoute } from 'astro';
import { bakeSpeciesList, bakedCommonNames } from '~/lib/bake';
import { loadSpeciesData } from '~/lib/species/data';
import { renderSpeciesCard } from '~/lib/og/species-card';

/** Open Graph image per pre-rendered species (satori + resvg at build). */
export async function getStaticPaths() {
  const list = await bakeSpeciesList();
  return list.map((s) => ({ params: { key: String(s.key) } }));
}

export const GET: APIRoute = async ({ params }) => {
  const names = await bakedCommonNames();
  const d = await loadSpeciesData(Number(params['key']), names);
  const png = await renderSpeciesCard({
    commonName: d.commonName,
    scientificName: d.canonicalName,
    count: d.count,
    image: d.images[0],
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
