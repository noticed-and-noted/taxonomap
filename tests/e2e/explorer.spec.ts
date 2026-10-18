/** Map explorer journeys, against the fake world (see fixtures.ts). */
import { expect, test } from './fixtures';

test('the header search and the What filter add to one list of taxa', { tag: '@mobile' }, async ({ page }, info) => {
  await page.goto('/?taxon=212');
  // The header search adds rather than replaces, from the baked name index.
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

test('a place search moves the map there', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search species or places' }).fill('london');
  await page.getByRole('option', { name: /Search places for/ }).click();
  await page.getByRole('option', { name: /^London/ }).click();
  // The view follows the camera (rounded, replace-throttled).
  await expect(page).toHaveURL(/view=-0\.\d+%2C51\.\d+/);
});

test('filters and year range live in the URL and survive reload', { tag: '@mobile' }, async ({ page }, info) => {
  await page.goto('/?taxon=2492462&photo=1&years=2000-2010&basis=HUMAN_OBSERVATION');
  // Phones pick a group's tab in the Filters sheet; desktop opens one group from the rail.
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: /Filters/ }).click();
    await page.getByRole('tab', { name: /How/ }).click();
  } else await page.getByRole('button', { name: 'How recorded, 2 active' }).click();
  await expect(page.getByRole('button', { name: 'Has photo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Close panel' }).click();
  // The year histogram starts collapsed; opening it is remembered across the reload.
  await page.getByRole('button', { name: 'Show records per year' }).click();
  const range = page.getByRole('region', { name: 'Year range' }).getByText('2000–2010');
  await expect(range).toBeVisible();
  await page.reload();
  await expect(range).toBeVisible();
});

test('rail filters write the URL and clear in one step', async ({ page }) => {
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

test('a hex selected in the URL opens the cell panel', async ({ page }) => {
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await expect(page.getByRole('heading', { name: 'Selected cell' })).toBeVisible();
  await expect(page.getByText(/records? in this cell/)).toBeVisible();
  await page.getByRole('tab', { name: 'By month' }).click();
  await expect(page.getByRole('img', { name: /Records by month/ })).toBeVisible();
});

test('the cell panel lists records with their type, expands one and filters them by species', async ({ page }) => {
  await page.goto('/?taxon=212&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await page.getByRole('tab', { name: 'Records' }).click();
  const rows = page.getByRole('table', { name: 'Records' }).locator('tbody tr');
  await expect(rows.first().getByLabel('Human observation')).toHaveText('OBS');
  await rows.first().getByRole('button').click();
  await expect(page.getByRole('link', { name: 'View on GBIF' })).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Filter records by species' });
  await search.click();
  const first = page.getByRole('listbox', { name: 'Species in this cell' }).getByRole('option').first();
  const name = (await first.locator('span').first().textContent())!;
  await search.fill(name.slice(0, 4));
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await expect(search).toHaveValue(name);
  await expect(rows).toHaveCount(3);
});
