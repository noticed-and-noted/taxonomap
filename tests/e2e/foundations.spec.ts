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
    await expect(page).toHaveURL(/\/tree$/);
    await page.getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page).toHaveURL(/\/\?photo=1&taxon=2492462/);
    await expect(page.getByTestId('map')).toHaveAttribute('data-marker', 'first');
  },
);
