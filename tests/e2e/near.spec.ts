/** "What's near me" journeys, against the fake world (see fixtures.ts). */
import { expect, test } from './fixtures';

const LONDON = '/?near=1&at=51.507,-0.128&r=2';

test(
  'near me is a mode of the map page that explains location use before asking',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Near me' }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/near=1/);
    await expect(page.getByText('About your location')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await page.getByRole('button', { name: 'Leave near me' }).click();
    await expect(page).not.toHaveURL(/near=1/);
  },
);

test('the old /near route redirects to the map', async ({ page }) => {
  await page.goto('/near?at=51.507,-0.128&r=2');
  await expect(page).toHaveURL(/\/\?near=1&at=51\.507/);
});

test('geolocation is rounded to ~100 m before use', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 51.5073509, longitude: -0.1277583 });
  // No request carries more precise coordinates.
  const precise: string[] = [];
  page.on('request', (r) => {
    if (/5073509|1277583/.test(decodeURIComponent(r.url()))) precise.push(r.url());
  });
  await page.goto('/?near=1');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page).toHaveURL(/at=51\.507%2C-0\.128|at=51\.507,-0\.128/);
  await expect(page.getByText(/records within 2 km/)).toBeVisible();
  expect(precise).toEqual([]);
});

test('lists species in a sortable table that one group can narrow', async ({ page }) => {
  await page.goto(LONDON);
  await expect(page.getByRole('link', { name: /Common Blackbird/ })).toBeVisible();
  await page.getByRole('button', { name: /^Species/ }).click();
  await expect(page.getByRole('columnheader', { name: /Species/ })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Filter' }).click();
  // The radio is sr-only under its label text, so click the label as a person would.
  const filters = page.getByRole('dialog', { name: 'Filter species' });
  await filters.locator('label', { hasText: 'Mammals' }).click();
  await expect(filters.getByRole('radio', { name: /Mammals/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Filter · 1/ })).toBeVisible();
  // The group's own species are loaded, not just the area's list filtered.
  await expect(page.getByRole('link', { name: /Red Fox/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Common Blackbird/ })).toHaveCount(0);
});

test("the records tab lists the circle's records as a map cell does", async ({ page }) => {
  await page.goto(LONDON);
  await page.getByRole('tab', { name: 'Records' }).click();
  await expect(page).toHaveURL(/tab=recent/);
  const records = page.getByRole('table', { name: 'Records' });
  await expect(records.getByText('Common Blackbird').first()).toBeVisible();
});

test('the share card counts the species in the circle', async ({ page }) => {
  await page.goto(LONDON);
  await expect(page.getByRole('link', { name: /Common Blackbird/ })).toBeVisible();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share what’s near' });
  await expect(dialog.getByRole('img', { name: /species recorded within 2 km/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('this-month filter and radius live in the URL', { tag: '@mobile' }, async ({ page }) => {
  await page.goto(LONDON);
  await page.getByRole('button', { name: /Recorded in/ }).click();
  await expect(page).toHaveURL(/month=1/);
  await page.getByRole('slider').first().fill('3');
  await expect(page).toHaveURL(/r=10/);
});
