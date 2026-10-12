import type { APIRoute } from 'astro';
import { bakeSpeciesManifest } from '~/lib/bake';

/** key → slug for pre-rendered species; other species link to /species/view?key=. */
export const GET: APIRoute = async () => Response.json(await bakeSpeciesManifest());
