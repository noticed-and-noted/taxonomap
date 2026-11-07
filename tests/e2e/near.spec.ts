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
  page.on('request', (request) => {
    if (/5073509|1277583/.test(decodeURIComponent(request.url()))) precise.push(request.url());
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
  await page.getByRole('button', { name: 'Hide What’s near me' }).click();
  await page.getByRole('button', { name: 'Show What’s near me' }).click();
  await page.getByRole('button', { name: /^Species/ }).click();
  await expect(page.getByRole('columnheader', { name: /Species/ })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Filter' }).click();
  const filters = page.getByRole('dialog', { name: 'Filter species' });
  await filters.getByRole('button', { name: /Mammals/ }).click();
  await expect(filters).toBeHidden();
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

test('radius lives in the URL', { tag: '@mobile' }, async ({ page }) => {
  await page.goto(LONDON);
  await page.getByRole('slider').first().fill('3');
  await expect(page).toHaveURL(/r=10/);
});

test('the place search picks by keyboard or pointer, and closes on Escape or a click away', async ({ page }) => {
  await page.goto('/?near=1');
  const box = page.getByRole('combobox', { name: 'Search for a place' });
  const places = page.getByRole('listbox', { name: 'Places' });
  await box.fill('nowhere at all');
  await expect(page.getByRole('status').filter({ hasText: /No places/ })).toBeVisible();
  await box.fill('london');
  await expect(places.getByRole('option')).toHaveCount(1);
  await box.press('ArrowDown');
  await box.press('ArrowUp');
  await page.keyboard.press('Escape');
  await expect(places).toBeHidden();
  await box.fill('london');
  await expect(places).toBeVisible();
  await page.mouse.click(5, 300);
  await expect(places).toBeHidden();

  // Enter takes the first match once the results are in.
  const answered = page.waitForResponse((response) => /london(\+|%20)city/.test(response.url()));
  await box.fill('london city');
  await answered;
  await expect(places.getByRole('option')).toHaveCount(1);
  await box.press('Enter');
  await expect(page).toHaveURL(/at=51\.507/);
});

test('a place picked from the list with the pointer moves the circle there', async ({ page }) => {
  await page.goto('/?near=1');
  const box = page.getByRole('combobox', { name: 'Search for a place' });
  await box.fill('london');
  const london = page.getByRole('listbox', { name: 'Places' }).getByRole('option', { name: /London/ });
  await london.hover();
  await london.click();
  await expect(page).toHaveURL(/at=51\.507/);
});

test('a refused location request says so', async ({ page }) => {
  // No permission granted, so the browser refuses.
  await page.goto('/?near=1');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText(/denied|blocked|permission/i).first()).toBeVisible();
});
