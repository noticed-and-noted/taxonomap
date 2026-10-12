import { expect, test } from '@playwright/test';

test('a pre-rendered species page has metadata, charts and attribution', async ({ page, request }) => {
  const manifest = (await (await request.get('/data/species-manifest.json')).json()) as Record<string, string>;
  const [key, slug] = Object.entries(manifest)[0] ?? [];
  test.skip(!key, 'no pre-rendered species in this build');
  await page.goto(`/species/${key}/${slug}`);
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

test('species without a static page render client-side, noindex', async ({ page, request }) => {
  const manifest = (await (await request.get('/data/species-manifest.json')).json()) as Record<string, string>;
  test.skip('2492462' in manifest, 'robin is pre-rendered in this build');
  await page.goto('/species/view?key=2492462');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.getByRole('heading', { level: 1, name: 'European Robin' })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveTitle(/European Robin/);
});

test('a missing species key shows a friendly message', async ({ page }) => {
  await page.goto('/species/view');
  await expect(page.getByRole('heading', { name: 'Species not found' })).toBeVisible();
});

test('unknown routes show the 404 page', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This page isn’t here' })).toBeVisible();
});
