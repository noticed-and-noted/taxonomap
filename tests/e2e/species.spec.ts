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
