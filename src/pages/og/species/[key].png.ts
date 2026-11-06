import type { APIRoute } from 'astro';
import { prerenderedSpecies, bakedSpeciesPage } from '~/lib/bake';
import { renderSpeciesCard } from '~/lib/og/species-card';

/**
 * Open Graph image per pre-rendered species (satori + resvg at build). No
 * photo: photos are only fetched in the browser, so a build-time one could
 * differ from the page's lead photo.
 */
export async function getStaticPaths() {
  const list = await prerenderedSpecies();
  return list.map((species) => ({ params: { key: String(species.key) } }));
}

/** Open Graph card PNG for a pre-rendered species. */
export const GET: APIRoute = async ({ params }) => {
  const { data: speciesData } = await bakedSpeciesPage(Number(params['key']));
  const png = await renderSpeciesCard({
    commonName: speciesData.commonName,
    scientificName: speciesData.canonicalName,
    count: speciesData.count,
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
