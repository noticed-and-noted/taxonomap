import type { APIRoute } from 'astro';
import { bakeTree } from '~/lib/bake';

/** Kingdom → order with record and species counts; deeper levels load live. */
export const GET: APIRoute = async () => Response.json(await bakeTree());
