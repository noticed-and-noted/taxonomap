import { expect, test } from '@playwright/test';

test('near me is a mode of the map page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Near me' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/near=1/);
  await expect(page.getByText('About your location')).toBeVisible();
  await page.getByRole('button', { name: 'Leave near me' }).click();
  await expect(page).not.toHaveURL(/near=1/);
});

test('the old /near route redirects to the map', async ({ page }) => {
  await page.goto('/near?at=51.507,-0.128&r=2');
  await expect(page).toHaveURL(/\/\?near=1&at=51\.507/);
});

test('explains location use before asking', async ({ page }) => {
  await page.goto('/?near=1');
  await expect(page.getByText('About your location')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
});

test('geolocation is rounded to ~100 m before use', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 51.5073509, longitude: -0.1277583 });
  await page.goto('/?near=1');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page).toHaveURL(/at=51\.507%2C-0\.128|at=51\.507,-0\.128/);
  // No request to GBIF carries more precise coordinates.
  const precise: string[] = [];
  page.on('request', (r) => {
    if (/5073509|1277583/.test(decodeURIComponent(r.url()))) precise.push(r.url());
  });
  await expect(page.getByText(/records within 2 km/)).toBeVisible({ timeout: 20_000 });
  expect(precise).toEqual([]);
});

test('lists species in a sortable table, ticks a checklist and exports it', async ({ page }) => {
  await page.goto('/?near=1&at=51.507,-0.128&r=2');
  await expect(page.getByRole('cell', { name: 'Birds' }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Species/ }).click();
  await expect(page.getByRole('columnheader', { name: /Species/ })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('dialog', { name: 'Filter species' }).getByRole('checkbox', { name: /Birds/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Filter · 1/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Seen/ }).first().check();
  await page.getByRole('tab', { name: 'Seen (1)' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/checklist.*\.csv$/);
});

test('this-month filter and radius live in the URL', async ({ page }) => {
  await page.goto('/?near=1&at=51.507,-0.128&r=2');
  await page.getByRole('button', { name: /Recorded in/ }).click();
  await expect(page).toHaveURL(/month=1/);
  await page.getByRole('slider').first().fill('3');
  await expect(page).toHaveURL(/r=10/);
});
