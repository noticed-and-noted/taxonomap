# Deployment

`.github/workflows/ci.yml` runs lint, format check, `astro check` and unit tests, then builds. It deploys to Cloudflare Pages on pushes to `main` (and manual dispatch); there is no scheduled deploy. A separate job runs `pnpm bake` daily (02:00 UTC, or on manual dispatch with the `bake` input) and saves the result in the Actions cache; the next build uses the latest saved bake and only fetches from GBIF when there is none, so fresh data reaches the site with the next deploy. Live contract tests run weekly or on manual dispatch.

Configure the repository with:

- **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- **Variables:** `CF_PAGES_PROJECT`, `GBIF_CONTACT_EMAIL`, `PUBLIC_SITE_URL`, and optionally `PUBLIC_GBIF_API_BASE`, `PUBLIC_GBIF_TILE_BASE`, `SPECIES_PRERENDER_COUNT`

**Request meter.** In dev, or with `?debug=requests` on any build, a small panel counts the tile, JSON and image requests made this session.
