/** The map's settings: colours, basemap and (on phones) theme. */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const rampStop = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--ramp-1'));

test('map colours are saved in the browser and the basemap in the URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  // The default ramp lives in tokens.css; another is written onto <html>.
  expect(await rampStop(page)).toBe('');
  await page.getByText('Viridis', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /^Viridis/ })).toBeChecked();
  await expect.poll(() => rampStop(page)).not.toBe('');
  await page.reload();
  await expect.poll(() => rampStop(page)).not.toBe('');

  const satelliteTile = page.waitForRequest(/\/basemap\/satellite\//);
  await page.getByText('Satellite', { exact: true }).click();
  await expect(page).toHaveURL(/base=satellite/);
  await satelliteTile;
});

test('a basemap picked while the map is still loading is the one it shows', async ({ page }) => {
  const STYLE_DELAY_MS = 1500;
  // Holding back the plain style keeps the map loading while the switcher is already usable.
  await page.route(/\/basemap\/\w+\.json$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, STYLE_DELAY_MS));
    await route.fallback();
  });
  await page.goto('/');
  const satelliteTile = page.waitForRequest(/\/basemap\/satellite\//);
  await page.getByText('Satellite', { exact: true }).click();
  await expect(page).toHaveURL(/base=satellite/);
  await satelliteTile;
});

test('the phone Filters sheet holds the theme picker', { tag: '@mobile' }, async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'desktop has the header toggle instead');
  await page.goto('/');
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByRole('tab', { name: 'Map' }).click();
  await page.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
