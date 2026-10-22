import { expect, test } from './fixtures';

test('tree loads the baked levels and zooms via the keyboard-accessible list', async ({ page }) => {
  await page.goto('/tree');
  const animals = page.getByRole('button', { name: /^Animals/ });
  await expect(animals).toBeVisible();
  await animals.click();
  await expect(page).toHaveURL(/focus=1(&|$)/);
  await expect(page).not.toHaveURL(/taxon=/);
  await expect(page.getByRole('navigation', { name: 'Tree position' })).toContainText('Animals');
});

test('deep links lazy-load levels below order', async ({ page }) => {
  await page.goto('/tree?focus=729');
  await expect(page.getByRole('heading', { level: 2, name: 'Perching Birds' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Corvidae/ })).toBeVisible();
});

test('layout and metric live in the URL', { tag: '@mobile' }, async ({ page }, info) => {
  await page.goto('/tree');
  // Narrow screens default to the icicle, so switch to the other layout.
  const [label, value, chart] =
    info.project.name === 'mobile' ? ['Sunburst', 'sunburst', /Sunburst of/] : ['Icicle', 'icicle', /Icicle chart/];
  await page.getByText(label, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`layout=${value}`));
  await page.getByText('Species', { exact: true }).click();
  await expect(page).toHaveURL(/metric=species/);
  await page.reload();
  await expect(page.getByRole('img', { name: chart })).toHaveAttribute('aria-label', /sized by species/);
});

test('the hidden map waits until the map is shown', async ({ page }) => {
  const mapLibreRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('maplibre-gl')) mapLibreRequests.push(request.url());
  });
  await page.goto('/tree');
  await expect(page.getByRole('button', { name: /^Animals/ })).toBeVisible();
  expect(mapLibreRequests).toEqual([]);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
});
