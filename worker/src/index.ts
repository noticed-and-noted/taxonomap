/**
 * Cloudflare Worker entry. See worker/README.md for setup.
 * Note: the Cache API is a no-op on *.workers.dev, so deploy on a custom
 * domain (routes in wrangler.toml).
 */
import { handle, type EdgeEnv } from './proxy';

interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  fetch(req: Request, env: EdgeEnv, ctx: ExecutionContextLike): Promise<Response> {
    const cache = (caches as unknown as { default: Cache }).default;
    return handle(req, env, {
      cache,
      fetch: (r) => fetch(r),
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};
