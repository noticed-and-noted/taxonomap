import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test('theme toggle persists across navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Tree of life' }).click();
  await expect(page).toHaveURL(/\/tree/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test(
  'map island persists across ClientRouter navigation and its params come back with it',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/?taxon=2492462&photo=1');
    const map = page.getByTestId('map');
    await expect(map).toBeVisible();
    // Tag the live DOM node; a remount would replace it.
    await map.evaluate((element) => ((element as HTMLElement).dataset['marker'] = 'first'));

    await page.getByRole('link', { name: 'Tree of life' }).click();
    await expect(page).toHaveURL(/\/tree\/$/);
    await page.getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page).toHaveURL(/\/\?photo=1&taxon=2492462/);
    await expect(page.getByTestId('map')).toHaveAttribute('data-marker', 'first');
  },
);

/**
 * Makes every page load in this test act like a browser without WebGL2, until the page sets
 * `webgl-restored` in sessionStorage (the user turning it back on before Try again).
 */
async function blockWebgl2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('webgl-restored')) return;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === 'webgl2' ? null : (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof getContext;
  });
}

const webglNotice = (page: Page) => page.getByRole('alert').filter({ hasText: 'The map can’t draw on this device' });

test('without WebGL2 the map shows how to fix it, and Try again brings the map back', async ({ page }) => {
  await blockWebgl2(page);
  await page.goto('/');
  const notice = webglNotice(page);
  await expect(notice).toBeVisible();
  await expect(notice.getByText('In Chrome')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);

  await page.evaluate(() => sessionStorage.setItem('webgl-restored', '1'));
  const hexTile = page.waitForResponse((response) => response.url().includes('/v2/map/'));
  await notice.getByRole('button', { name: 'Try again' }).click();
  await hexTile;
  await expect(notice).toBeHidden();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
});

test('Try again while WebGL2 is still off shows the notice again, not a blank map', async ({ page }) => {
  await blockWebgl2(page);
  await page.goto('/');
  const notice = webglNotice(page);
  await expect(notice).toBeVisible();

  const reloaded = page.waitForEvent('load');
  await notice.getByRole('button', { name: 'Try again' }).click();
  await reloaded;
  await expect(notice).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);
});
