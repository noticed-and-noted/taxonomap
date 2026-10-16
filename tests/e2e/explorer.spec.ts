/**
 * Map explorer journeys. These hit the live GBIF API and basemap tiles.
 */
import { expect, test } from '@playwright/test';

test('omnibox finds a species by common name and filters the map', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('european robin');
  const option = page.getByRole('option', { name: /^European Robin/i }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/taxon=2492462/);
  await expect(page.getByRole('button', { name: /Remove taxon filter European Robin/i })).toBeVisible();
});

test('filters and year range live in the URL and survive reload', async ({ page }, info) => {
  await page.goto('/?taxon=2492462&photo=1&years=2000-2010&basis=HUMAN_OBSERVATION');
  // Phones show every group in the Filters sheet; desktop opens one group from the rail.
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Filters/ }).click();
  else await page.getByRole('button', { name: 'How recorded, 2 active' }).click();
  await expect(page.getByRole('button', { name: 'Has photo' })).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close panel' }).click();
  // The year histogram starts collapsed; opening it is remembered across the reload.
  await page.getByRole('button', { name: 'Show records per year' }).click();
  await expect(page.getByText('2000–2010')).toBeVisible();
  await page.reload();
  await expect(page.getByText('2000–2010')).toBeVisible();
});

test('rail filters write the URL and clear in one step', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the rail is desktop-only');
  await page.goto('/?taxon=2492462');
  await page.getByRole('button', { name: 'When', exact: true }).click();
  await page.getByRole('button', { name: 'April' }).click();
  await page.getByRole('button', { name: 'May' }).click();
  await expect(page).toHaveURL(/months=4%2C5/);
  await expect(page.getByRole('button', { name: 'When, 1 active' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#filter-flyout')).toBeHidden();
  // One step back undoes Clear, which resets every filter, taxa included.
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page).not.toHaveURL(/months=|taxon=/);
  await page.goBack();
  await expect(page).toHaveURL(/months=4%2C5/);
  await expect(page).toHaveURL(/taxon=2492462/);
});

test('the header search and the What filter add to one list of taxa', async ({ page }, info) => {
  await page.goto('/?taxon=212');
  // The header search adds rather than replaces.
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('european robin');
  await page
    .getByRole('option', { name: /^European Robin/i })
    .first()
    .click();
  await expect(page).toHaveURL(/taxon=212%2C2492462/);
  await expect(page.getByRole('button', { name: 'Remove taxon filter Birds' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove taxon filter European Robin/i })).toBeVisible();

  test.skip(info.project.name === 'mobile', 'the sheet shares the same picker');
  await page.getByRole('button', { name: 'What, 1 active' }).click();
  const picker = page.getByRole('combobox', { name: 'Species and groups' });
  await picker.fill('blackbird');
  await page
    .getByRole('option', { name: /Common Blackbird/i })
    .first()
    .click();
  await expect(page).toHaveURL(/taxon=212%2C2490719%2C2492462/);
  await page.getByRole('button', { name: 'Remove taxon filter Birds' }).click();
  await expect(page).toHaveURL(/taxon=2490719%2C2492462/);
});

test('a hex selected in the URL opens the cell panel', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'covered on desktop; the sheet shares the same content');
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await expect(page.getByRole('heading', { name: 'Selected cell' })).toBeVisible();
  await expect(page.getByText(/records? in this cell/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('img', { name: /Records by month/ })).toBeVisible();
});
