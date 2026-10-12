import { expect, test } from '@playwright/test';

test('compare two species from the URL', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'compare card is the same on mobile');
  await page.goto('/?compare=species&taxon=2492462&taxonB=9510564');
  const card = page.getByRole('region', { name: 'Compare' });
  await expect(card).toContainText('European Robin', { timeout: 15_000 });
  await expect(card).toContainText('American Robin');
});

test('swipe between two year ranges with the keyboard', async ({ page }) => {
  await page.goto('/?compare=years&years=1900-1999&yearsB=2000-2026');
  const handle = page.getByRole('slider', { name: 'Swipe between the two year ranges' });
  await expect(handle).toBeVisible({ timeout: 15_000 });
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '55');
});

test('decade animation steps through years without flooding history', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Play through the decades' }).click();
  await expect(page).toHaveURL(/years=1900-1909/);
  await expect(page).toHaveURL(/years=1910-1919/, { timeout: 5_000 });
  await page.getByRole('button', { name: 'Pause the decade animation' }).click();
  expect(await page.evaluate(() => history.length)).toBe(before);
});

test('the app shell works offline; unvisited pages show the offline page', async ({ page, context, request }) => {
  const manifest = (await (await request.get('/data/species-manifest.json')).json()) as Record<string, string>;
  const [key, slug] = Object.entries(manifest)[0] ?? [];
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await context.setOffline(true);
  await page.goto('/tree?focus=1');
  await expect(page.getByRole('heading', { name: 'Tree of life' })).toBeVisible();
  if (key) {
    await page.goto(`/species/${key}/${slug}`);
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  }
  await context.setOffline(false);
});
