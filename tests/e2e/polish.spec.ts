import { expect, test } from './fixtures';

test('decade animation steps through years without flooding history', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => history.length);
  // The histogram starts collapsed.
  await page.getByRole('button', { name: 'Show records per year' }).click();
  await page.getByRole('button', { name: 'Play through the decades' }).click();
  await expect(page).toHaveURL(/years=1900-1909/);
  await expect(page).toHaveURL(/years=1910-1919/, { timeout: 5_000 });
  await page.getByRole('button', { name: 'Pause the decade animation' }).click();
  expect(await page.evaluate(() => history.length)).toBe(before);
});

test.describe(() => {
  test.use({ serviceWorkers: 'allow' });

  test('the app shell works offline; unvisited pages show the offline page', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    // setOffline alone does not stop the service worker's own fetches in Chromium: refuse every request too.
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    await page.goto('/tree?focus=1');
    await expect(page.getByRole('heading', { name: 'Tree of life' })).toBeVisible();
    // The fake world's one pre-rendered species page, never visited.
    await page.goto('/species/2490719/turdus-merula');
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  });
});
