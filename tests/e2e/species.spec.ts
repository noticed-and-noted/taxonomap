import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test('a pre-rendered species page has metadata, charts and attribution', async ({ page, request }) => {
  // The fake world pre-renders one species: the blackbird.
  const key = 2490719;
  await page.goto(`/species/${key}/turdus-merula`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    new RegExp(`/og/species/${key}\\.png$`),
  );
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await expect(page.getByText('Records per year', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Top countries', { exact: true }).first()).toBeVisible();
  // Every chart has a data-table fallback.
  expect(await page.getByText('Show data table').count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('link', { name: 'GBIF.org', exact: true })).toBeVisible();
  // Looked up in the browser, not baked into the page.
  await expect(page.getByRole('heading', { name: 'What the name means' })).toBeVisible();
  await expect(page.getByText('“blackbird”')).toBeVisible();
  const og = await request.get(`/og/species/${key}.png`);
  expect(og.headers()['content-type']).toContain('image/png');
});

test('species without a static page render client-side, noindex', async ({ page }) => {
  // Stand in for the Pages rewrite in public/_redirects, which `astro preview` does not apply.
  await page.route(/\/species\/view\/\d+$/, async (route) =>
    route.fulfill({ response: await route.fetch({ url: new URL('/species/view/', route.request().url()).href }) }),
  );
  await page.goto('/species/view/2492462');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('heading', { level: 1, name: 'European Robin' })).toBeVisible();
  await expect(page).toHaveTitle(/European Robin/);
});

test('a missing species key shows a friendly message', async ({ page }) => {
  await page.goto('/species/view');
  await expect(page.getByRole('heading', { name: 'Species not found' })).toBeVisible();
});

test('unknown routes show the 404 page', async ({ page }) => {
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This page isn’t here' })).toBeVisible();
});

test('a species page opens its photos in a lightbox and links similar species', async ({ page }) => {
  await page.goto('/species/2490719/turdus-merula');
  await page.getByRole('button', { name: /^Enlarge photo 1 of \d+$/ }).click();
  const lightbox = page.getByRole('dialog', { name: 'Common Blackbird photos' });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByText(/^1 \/ \d+$/)).toBeVisible();
  await lightbox.getByRole('button', { name: 'Next photo' }).click();
  await expect(lightbox.getByText(/^2 \/ \d+$/)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(lightbox.getByText(/^1 \/ \d+$/)).toBeVisible();
  await lightbox.getByRole('button', { name: 'Previous photo' }).click();
  await lightbox.getByRole('button', { name: 'Photo 2 of', exact: false }).click();
  await expect(lightbox.getByText(/^2 \/ \d+$/)).toBeVisible();
  await lightbox.getByRole('button', { name: 'Close' }).click();
  await expect(lightbox).toBeHidden();
  // A smaller photo in the gallery opens the lightbox at that photo.
  await page.getByRole('button', { name: /^Enlarge photo 2 of/ }).click();
  await expect(lightbox.getByText(/^2 \/ \d+$/)).toBeVisible();
  await page.keyboard.press('Escape');

  // The song thrush shares the blackbird's genus.
  const similar = page.getByRole('region', { name: 'Similar species' });
  await similar.scrollIntoViewIfNeeded();
  const thrush = similar.getByRole('link', { name: /Song Thrush/ });
  await expect(thrush).toHaveAttribute('href', /2490680/);
  // Once the cards hydrate, they look up a photo for each species.
  await expect(thrush.getByRole('img', { name: 'Song Thrush (Turdus philomelos)' })).toBeVisible();
});

/** Serves /species/view/<key> as the Pages rewrite in public/_redirects would (`astro preview` does not apply it). */
async function serveClientSpeciesPages(page: Page) {
  await page.route(/\/species\/view\/\d+$/, async (route) =>
    route.fulfill({ response: await route.fetch({ url: new URL('/species/view/', route.request().url()).href }) }),
  );
}

test('a client-rendered species shows its Red List status and introduced range', async ({ page }) => {
  await serveClientSpeciesPages(page);
  // Not in the name index, so the page asks iNaturalist for its name.
  await page.route('**/data/names.json', (route) =>
    route.fulfill({ json: { v: 1, generated: '2026-01-01T00:00:00Z', names: [] } }),
  );
  await page.route('**/v1/species/2492462/iucnRedListCategory', (route) =>
    route.fulfill({ json: { code: 'VU', iucnTaxonID: '22710_1' } }),
  );
  const introduced = ['IE', 'FR', 'DE', 'ES', 'IT', 'PT', 'NL'];
  await page.route('**/v1/species/2492462/distributions*', (route) =>
    route.fulfill({
      json: {
        endOfRecords: true,
        results: [
          ...introduced.map((country) => ({ country, establishmentMeans: 'INTRODUCED', source: 'GRIIS' })),
          { country: 'NZ', establishmentMeans: 'INVASIVE', source: 'GRIIS' },
        ],
      },
    }),
  );
  await page.route('**/v1/species/2492462/vernacularNames*', (route) =>
    route.fulfill({
      json: {
        endOfRecords: true,
        results: [
          { vernacularName: 'European Robin', language: 'eng' },
          { vernacularName: 'Rouge-gorge familier', language: 'fra' },
        ],
      },
    }),
  );
  await page.route('**/v1/species/2492462/synonyms*', (route) =>
    route.fulfill({ json: { endOfRecords: true, results: [{ scientificName: 'Motacilla rubecula' }] } }),
  );
  await page.goto('/species/view/2492462');
  await expect(page.getByText('Vulnerable').first()).toBeVisible();
  await expect(page.getByText('Motacilla rubecula')).toHaveCount(1);
  await page.getByText(/other languages?/).click();
  await expect(page.getByText('Rouge-gorge familier')).toBeVisible();
  await expect(page.getByText('Introduced range').first()).toBeVisible();
});

// The redirects below are answered with no content, so the page that sends them stays (and its coverage is kept).
test('a client-rendered link to a pre-rendered species moves to its page', async ({ page }) => {
  await serveClientSpeciesPages(page);
  // A 204 answer leaves the browser on the page that asked.
  await page.route(/\/species\/2490719\/turdus-merula/, (route) => route.fulfill({ status: 204 }));
  const redirect = page.waitForRequest(/\/species\/2490719\/turdus-merula/);
  await page.goto('/species/view/2490719');
  await redirect;
});

test('a species GBIF does not know opens the tree there, and one it cannot load says so', async ({ page }) => {
  await serveClientSpeciesPages(page);
  await page.route('**/tree/?focus=99999999', (route) => route.fulfill({ status: 204 }));
  const redirect = page.waitForRequest('**/tree/?focus=99999999');
  await page.goto('/species/view/99999999');
  await redirect;

  await page.route('**/v1/species/2492462', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/species/view/2492462');
  await expect(page.getByRole('alert')).toBeVisible();
});

test('a species page’s charts show a tip for the year, bar or month under the pointer', async ({ page }) => {
  await page.goto('/species/2490719/turdus-merula');
  const years = page.locator('.plot-box').first();
  await years.scrollIntoViewIfNeeded();
  await expect(years.locator('svg').first()).toBeVisible();
  const yearsBox = (await years.boundingBox())!;
  for (const share of [0.6, 0.7, 0.8])
    await page.mouse.move(yearsBox.x + yearsBox.width * share, yearsBox.y + yearsBox.height / 2);
  await expect(page.locator('[popover]').first()).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(0, 0);

  const months = page.getByRole('img', { name: /Records by month/ }).first();
  await months.scrollIntoViewIfNeeded();
  const monthsBox = (await months.boundingBox())!;
  await page.mouse.move(monthsBox.x + monthsBox.width / 2, monthsBox.y + monthsBox.height * 0.2);
  await expect(page.locator('[popover]').first()).toBeVisible();
  // Outside the ring, the tip goes.
  await page.mouse.move(monthsBox.x + 1, monthsBox.y + 1);
  await page.mouse.move(0, 0);

  // A theme switch redraws the charts.
  await page.getByRole('button', { name: /Switch to light theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a species page plays iNaturalist recordings, steps between them and drops one that will not play', async ({
  page,
  context,
}) => {
  // The blackbird's iNaturalist taxon, as an earlier visit would have remembered it.
  await context.addInitScript(() => localStorage.setItem('inat-ids-v3', JSON.stringify([[2490719, 12716]])));
  const recording = (id: number) => ({
    id,
    uri: `https://www.inaturalist.org/observations/${id}`,
    place_ids: [6857],
    sounds: [
      {
        file_url: id === 3 ? 'https://sounds.example/missing.wav' : `https://sounds.example/${id}.wav`,
        license_code: 'cc-by',
        attribution: `(c) Recordist ${id}, some rights reserved (CC BY)`,
      },
    ],
  });
  await page.route(/\/inat\/v2\/observations/, (route) =>
    route.fulfill({ json: { results: [1, 2, 3].map(recording) } }),
  );
  await page.route(/\/inat\/v2\/taxa\/12716/, (route) =>
    route.fulfill({ json: { results: [{ id: 12716, name: 'Turdus merula', rank_level: 10 }] } }),
  );
  await page.route(/\/inat\/v2\/places\//, (route) =>
    route.fulfill({ json: { results: [{ id: 6857, name: 'United Kingdom', admin_level: 0 }] } }),
  );
  await page.route('https://sounds.example/missing.wav', (route) => route.fulfill({ status: 404 }));
  await page.goto('/species/2490719/turdus-merula');
  const sounds = page.getByRole('region', { name: 'Sounds' });
  await expect(sounds.getByText('1 of 3')).toBeVisible();
  await sounds.getByRole('button', { name: 'Next recording' }).click();
  await sounds.getByRole('button', { name: 'Previous recording' }).click();
  await sounds.getByRole('button', { name: 'Previous recording' }).click();
  await expect(sounds.getByText('3 of 3')).toBeVisible();
  await sounds.getByRole('button', { name: 'Play sound' }).click();
  // The broken file is dropped, and a recording that plays takes its place.
  await expect(sounds.getByRole('link', { name: '© Recordist 3' })).toHaveCount(0);
  await expect(sounds.getByRole('button', { name: 'Play sound' })).toBeVisible();
});

test('a species page without photos, map tiles or its chart library still reads', async ({ page, context }) => {
  // A remembered iNaturalist taxon that iNaturalist then fails to return: the photo lookup fails outright.
  await context.addInitScript(() => localStorage.setItem('inat-ids-v3', JSON.stringify([[2490719, 12716]])));
  await page.route(/\/inat\/v2\/taxa/, (route) => route.fulfill({ status: 400, body: '' }));
  await page.route(/\.mvt(\?|$)/, (route) => route.fulfill({ status: 500, body: '' }));
  await page.route(/\/_astro\/plot\.[\w-]+\.js$/, (route) => route.abort('failed'));
  await page.route(/\/v1\/occurrence\/search/, (route) => route.fulfill({ status: 500, body: '' }));
  await page.route(/\/graphql/, (route) => route.fulfill({ status: 500, body: '' }));
  await page.goto('/species/2490719/turdus-merula');
  await page.locator('.plot-box').first().scrollIntoViewIfNeeded();
  await expect(
    page.getByText('The chart could not be drawn; the data table below has the same figures.').first(),
  ).toBeVisible();
  // Leaving through the header keeps the page's islands until they are swapped out.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tree of life' }).click();
  await expect(page.getByRole('heading', { name: 'Tree of life' })).toBeVisible();
});
