import { expect, test } from '@playwright/test';

test('theme toggle persists across navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Tree of life' }).click();
  await expect(page).toHaveURL(/\/tree/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('map island persists across ClientRouter navigation and the taxon carries over', async ({ page }) => {
  await page.goto('/?taxon=2492462');
  const map = page.getByTestId('map');
  await expect(map).toBeVisible();
  // Tag the live DOM node; a remount would replace it.
  await map.evaluate((el) => ((el as HTMLElement).dataset['marker'] = 'first'));

  await page.getByRole('link', { name: 'Tree of life' }).click();
  await expect(page).toHaveURL(/\/tree\?taxon=2492462/);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page).toHaveURL(/\/\?taxon=2492462/);
  await expect(page.getByTestId('map')).toHaveAttribute('data-marker', 'first');
});
