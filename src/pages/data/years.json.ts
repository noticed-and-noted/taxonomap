import type { APIRoute } from 'astro';
import { bakeYears } from '~/lib/bake';

/** Baked at build time; islands read this before going live. */
export const GET: APIRoute = async () => Response.json(await bakeYears());
