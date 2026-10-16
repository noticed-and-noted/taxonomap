# GBIF edge cache (optional Cloudflare Worker)

This Worker sits between the site and `api.gbif.org` and caches responses at Cloudflare's edge, so every visitor shares them. Without it, each browser keeps only its own cache, and GBIF serves every request.

**What it does** (logic in `src/proxy.ts`, tests in `tests/unit/worker.test.ts`):

- **Proxies only an allowlist of GBIF paths:** map tiles, occurrence search and records, species, datasets, organisations, and image thumbnails. Only GET requests are accepted.
- **Normalises query strings,** so equivalent requests share one cache entry.
- **Keeps each entry fresh for a set time**, depending on the request type:

  | Request type                        | Fresh for |
  | ----------------------------------- | --------- |
  | Tiles (including empty 204 tiles)   | 24 h      |
  | Occurrence search                   | 6 h       |
  | Species, datasets and organisations | 7 days    |
  | Thumbnails                          | 30 days   |

- **Serves stale entries for longer** (stale-while-revalidate). A stale entry is returned immediately while one background request refreshes it. Stale entries are also served when GBIF errors.
- **Merges concurrent misses** for the same URL into one upstream request.
- **Identifies itself to GBIF** with `User-Agent: Taxonomap-edge/<version> (contact: …)`.
- **Restricts CORS to your site's origins** (`ALLOWED_ORIGINS`). JSON and tile requests from other origins are refused.
- **Marks every response with `x-gbif-edge`** (`HIT`, `MISS`, `STALE`, `BYPASS` or `REJECT`).

**Fallback in the app.** If the Worker fails at the platform level (quota exceeded, outage, network error), the app switches to `api.gbif.org` for 5 minutes and then tries the edge again (`src/lib/gbif/edge.ts`). GBIF errors relayed by the Worker don't trigger this; they use normal retries. Build-time requests always go to GBIF directly, so CI never spends the Worker's quota.

## Requirements

- A Cloudflare account (the free plan allows 100,000 requests/day).
- A domain on Cloudflare. The Cache API does nothing on `*.workers.dev`, so the Worker needs a custom domain such as `gbif.taxonomap.com`.

## Setup

1. In `worker/wrangler.toml`, check the `routes` hostname, `CONTACT_EMAIL` and `ALLOWED_ORIGINS` (your Pages URL and custom site domain, comma-separated).
2. Deploy, either:
   - **locally:** run `npx wrangler login`, then `npm run worker:deploy`; or
   - **from CI:** set the repository variables `EDGE_ENABLED=true`, `EDGE_ALLOWED_ORIGINS` and `GBIF_CONTACT_EMAIL`, and the secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template, scoped to the account and zone) and `CLOUDFLARE_ACCOUNT_ID`. `.github/workflows/worker.yml` deploys on pushes to `main` that touch `worker/`.
3. Check it: `https://gbif.taxonomap.com/health` should return `Taxonomap edge cache`.
4. Point the site at it with the repository variables `PUBLIC_GBIF_API_BASE` and `PUBLIC_GBIF_TILE_BASE` set to `https://gbif.taxonomap.com`, then rebuild.

## Local testing

```bash
npm run worker:dev
```

That serves the Worker on `http://localhost:8787`. Run the site against it with `PUBLIC_GBIF_API_BASE=http://localhost:8787 PUBLIC_GBIF_TILE_BASE=http://localhost:8787 npm run dev`. The request meter (shown in dev, or with `?debug=requests`) reports how many requests went via the edge.
