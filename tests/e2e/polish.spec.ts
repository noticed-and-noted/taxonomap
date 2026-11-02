import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

const SW_PATH = 'dist/sw.js';

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
    await page.goto('/tree/?focus=1');
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
    await expect(page).toHaveURL('/tree/?focus=1');

    await context.unroute('**/*');
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Tree of life' })).toBeVisible();
  });

  test('name searches stay out of the service worker, so typing on can cancel them', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    await page.getByRole('combobox', { name: 'Search species or places' }).fill('robin');
    await expect(page.getByRole('option', { name: /^European Robin/i }).first()).toBeVisible();
    const isCached = (path: string) =>
      page.evaluate(async (wanted) => {
        const keys = await (await caches.open('gbif-json')).keys();
        return keys.some((request) => request.url.includes(wanted));
      }, path);
    // Other GBIF answers are cached, which shows the worker was in the way.
    await expect.poll(() => isCached('/v1/occurrence/search')).toBe(true);
    expect(await isCached('/v1/species/suggest')).toBe(false);
    expect(await isCached('qField=VERNACULAR')).toBe(false);
  });

  test('a new deploy offers a reload, which switches to it', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    // Stand in for a deploy by changing one precache revision. Playwright can't route a worker's own script, so
    // the file changes on disk; same length, as the preview server caches each file's size.
    const original = await readFile(SW_PATH, 'utf8');
    await writeFile(
      SW_PATH,
      original.replace(/revision:"(.)/, (_match, first: string) => `revision:"${first === '0' ? '1' : '0'}`),
    );
    try {
      // The browser's own update check, which the page also runs on navigation and on a timer.
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    } finally {
      await writeFile(SW_PATH, original);
    }
    const notice = page.getByRole('status').filter({ hasText: 'A new version of Taxonomap is available.' });
    await expect(notice).toBeVisible();
    await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Reload' }).click()]);
    await expect(notice).toBeHidden();
  });
});
