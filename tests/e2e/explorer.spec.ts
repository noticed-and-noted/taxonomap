/**
 * Map explorer journeys. These hit the live GBIF API and basemap tiles.
 */
import { expect, test } from '@playwright/test';

test('omnibox finds a species by common name and filters the map', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('european robin');
  const option = page.getByRole('option', { name: /European Robin/i }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/taxon=2492462/);
  await expect(page.getByRole('button', { name: /Remove taxon filter European Robin/i })).toBeVisible();
});

test('filters and year range live in the URL and survive reload', async ({ page }, info) => {
  await page.goto('/?taxon=2492462&photo=1&years=2000-2010&basis=HUMAN_OBSERVATION');
  // On phones the filter chips live in the Filters sheet.
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByRole('button', { name: 'Has photo' })).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByText('2000–2010')).toBeVisible();
  await page.reload();
  await expect(page.getByText('2000–2010')).toBeVisible();
});

test('a hex selected in the URL opens the cell panel', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'covered on desktop; the sheet shares the same content');
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await expect(page.getByRole('heading', { name: 'Selected cell' })).toBeVisible();
  await expect(page.getByText(/records? in this cell/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('img', { name: /Records by month/ })).toBeVisible();
});
