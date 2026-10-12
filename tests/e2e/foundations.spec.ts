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

test('map slot persists across ClientRouter navigation and taxon carries over', async ({ page }) => {
  await page.goto('/');
  const mounted = await page.getByTestId('mounted-at').textContent();
  await page.getByTestId('pick-taxon').click();
  await expect(page).toHaveURL(/taxon=2492462/);

  await page.getByRole('link', { name: 'Tree of life' }).click();
  await expect(page).toHaveURL(/\/tree\?taxon=2492462/);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page).toHaveURL(/\/\?taxon=2492462/);
  await expect(page.getByTestId('mounted-at')).toHaveText(mounted ?? '');
});

test('back button restores store state', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pick-taxon').click();
  await expect(page.getByTestId('taxon')).toHaveText('2492462');
  await page.goBack();
  await expect(page.getByTestId('taxon')).toHaveText('—');
});
