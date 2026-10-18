import { expect, test } from './fixtures';

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
