import { expect, test } from './fixtures';

test.describe(() => {
  test.use({ serviceWorkers: 'allow' });

  test('offline, every page is the offline page, and it reloads when the connection returns', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    // setOffline alone does not stop the service worker's own fetches in Chromium: refuse every request too.
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    // The page that was open reloads into the offline page.
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
    // Chromium can still have that reload in flight, which would cancel the next navigation.
    await page.waitForLoadState('networkidle');
    await page.goto('/tree/?focus=1');
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
    await expect(page).toHaveURL('/tree/?focus=1');

    await context.unroute('**/*');
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Tree of life' })).toBeVisible();
  });
});
