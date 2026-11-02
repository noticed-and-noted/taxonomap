/** Map explorer journeys, against the fake world (see fixtures.ts). */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const INATURALIST_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';

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
  await page.getByRole('button', { name: 'What, 2 active' }).click();
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

test('Enter straight after typing picks what is typed, not the results still on screen', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('european robin');
  await expect(page.getByRole('option', { name: /^European Robin/i }).first()).toBeVisible();
  // Inside the debounce, while the robin is still the highlighted row.
  await box.fill('common blackbird');
  await box.press('Enter');
  await expect(page.getByRole('button', { name: /Remove taxon filter Common Blackbird/i })).toBeVisible();
  await expect(page).toHaveURL(/taxon=2490719/);
});

test('a live result holds its name’s place until iNaturalist answers', async ({ page }) => {
  // No baked names, so every result is live and needs a lookup.
  await page.route('**/data/names.json', (route) =>
    route.fulfill({ json: { v: 1, generated: '2026-01-01T00:00:00Z', names: [] } }),
  );
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    // The lookup's GBIF searches, not the name search itself, which names the backbone dataset.
    (url) => url.host === 'graphql.gbif.org' || url.searchParams.get('datasetKey') === INATURALIST_DATASET,
    async (route) => {
      await released;
      await route.fallback();
    },
  );
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search species or places' }).fill('robin');
  // An option's children are presentational, so the placeholder isn't in the accessibility tree there.
  const robin = page.getByRole('option', { name: /Erithacus rubecula/i }).first();
  const skeleton = robin.locator('.skeleton');
  await expect(skeleton).toBeVisible();
  await expect(robin).not.toContainText('European Robin');
  release();
  await expect(skeleton).toHaveCount(0);
  await expect(page.getByRole('option', { name: /^European Robin/i }).first()).toBeVisible();
});

test(
  'on touch, the first tap on a search result previews it and the second picks it',
  { tag: '@mobile' },
  async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mice preview on hover instead');
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Search species or places' }).fill('robin');
    const robin = page.getByRole('option', { name: /^European Robin/i }).first();
    await expect(page.getByRole('region', { name: 'Preview: Robins' })).toBeVisible();
    await robin.tap();
    await expect(page.getByRole('region', { name: 'Preview: European Robin' })).toBeVisible();
    await expect(page).not.toHaveURL(/taxon=/);
    await robin.tap();
    await expect(page).toHaveURL(/taxon=2492462/);
  },
);

test('a place search moves the map there', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search species or places' }).fill('london');
  await page.getByRole('option', { name: /Search places for/ }).click();
  // Typing more stays on places, with a way back to species.
  await page.getByRole('combobox', { name: 'Search species or places' }).pressSequentially(' city');
  await expect(page.getByRole('option', { name: /Search species for “london city”/ })).toBeVisible();
  await page.getByRole('option', { name: /^London/ }).click();
  // The view follows the camera (rounded, replace-throttled).
  await expect(page).toHaveURL(/view=-0\.\d+%2C51\.\d+/);
});

test('filters and year range live in the URL and survive reload', { tag: '@mobile' }, async ({ page }, info) => {
  await page.goto('/?taxon=2492462&photo=1&when=y:2000..2010&basis=HUMAN_OBSERVATION');
  // Phones pick a group's tab in the Filters sheet; desktop opens one group from the rail.
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: /Filters/ }).click();
    await page.getByRole('tab', { name: /How/ }).click();
  } else await page.getByRole('button', { name: 'How recorded, 2 active' }).click();
  await expect(page.getByRole('button', { name: 'Has photo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The year slider lives in the When group.
  const openWhen = () =>
    info.project.name === 'mobile'
      ? page.getByRole('tab', { name: /When/ }).click()
      : page.getByRole('button', { name: /^When/ }).click();
  await openWhen();
  const range = page.getByRole('region', { name: 'Year range' }).getByText('2000–2010');
  await expect(range).toBeVisible();
  await page.reload();
  // The Filters sheet is in the URL, so on phones it reopens by itself.
  await openWhen();
  await expect(range).toBeVisible();
});

test('rail filters write the URL and clear in one step', async ({ page }) => {
  await page.goto('/?taxon=2492462');
  await page.getByRole('button', { name: 'When', exact: true }).click();
  await page.getByRole('button', { name: 'April' }).click();
  await page.getByRole('button', { name: 'May' }).click();
  await expect(page).toHaveURL(/months=4%2C5/);
  // Each month is its own filter.
  await expect(page.getByRole('button', { name: 'When, 2 active' })).toBeVisible();
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
  await expect(page.getByRole('img', { name: /Records by month/ })).toBeVisible();
});

test('the cell panel lists records with their type, expands one and filters them by species', async ({ page }) => {
  await page.goto('/?taxon=212&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await page.getByRole('tab', { name: 'Records' }).click();
  const rows = page.getByRole('table', { name: 'Records' }).locator('tbody tr');
  await expect(rows.first().getByLabel('Human observation')).toHaveText('OBS');
  await rows.first().getByRole('button').click();
  await expect(page.getByRole('link', { name: /GBIF record/ })).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Filter records by species' });
  await search.click();
  const first = page.getByRole('listbox', { name: 'Species in this cell' }).getByRole('option').first();
  const name = (await first.locator('span').first().textContent())!;
  await search.fill(name.slice(0, 4));
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await expect(search).toHaveValue(name);
  await expect(rows).toHaveCount(3);
});

/** Opens the cell panel's records and expands the first one. */
async function expandFirstRecord(page: Page) {
  await page.goto('/?taxon=212&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await page.getByRole('tab', { name: 'Records' }).click();
  await page.getByRole('table', { name: 'Records' }).locator('tbody tr').first().getByRole('button').click();
}

test('an expanded record plays its sound to the end, with its licence and credit', async ({ page }) => {
  const soundRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'sounds.example') soundRequests.push(request.url());
  });
  await expandFirstRecord(page);
  const play = page.getByRole('button', { name: 'Play sound' });
  await expect(play).toBeVisible();
  const credit = page.locator('p', { hasText: 'Sound ·' });
  await expect(credit).toHaveText('Sound · CC-BY · © A. Recordist');
  await expect(credit.getByRole('link', { name: 'CC-BY' })).toHaveAttribute('href', /licenses\/by\/4\.0/);
  // The file comes from its publisher, so nothing is fetched until the viewer asks for it.
  expect(soundRequests).toEqual([]);

  await play.click();
  await expect(page.getByRole('button', { name: 'Pause sound' })).toBeVisible();
  // The short fake sound ends on its own: the button resets and the line is full.
  await expect(play).toBeVisible();
  await expect(page.getByText('0:03 / 0:03')).toBeVisible();
  const position = page.getByRole('slider', { name: 'Position in sound' });
  expect(await position.inputValue()).toBe(await position.getAttribute('max'));
  expect(soundRequests).not.toEqual([]);
});

test('dragging the line moves the sound to that point', async ({ page }) => {
  await expandFirstRecord(page);
  // The line only knows the sound's length once it has started loading.
  await page.getByRole('button', { name: 'Play sound' }).click();
  await page.getByRole('button', { name: 'Pause sound' }).click();
  await expect(page.getByText(/^0:00 \/ 0:03$/)).toBeVisible();

  const line = page.getByRole('slider', { name: 'Position in sound' });
  const box = (await line.boundingBox())!;
  const middle = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.1, middle);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, middle, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByText(/^0:01 \/ 0:03$/)).toBeVisible();
  await expect(line).toHaveAttribute('aria-valuetext', '0:01');
  const seconds = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime);
  expect(seconds).toBeGreaterThan(1.2);
  expect(seconds).toBeLessThan(1.8);
  await expect(page.getByRole('button', { name: 'Play sound' })).toBeVisible();
});

test("the line stays with the sound when its host can't seek", async ({ page }) => {
  // Whole files only, no byte ranges: Chrome can't move such a sound.
  await page.route('https://sounds.example/**', (route) =>
    route.fallback({ headers: { ...route.request().headers(), range: '' } }),
  );
  await expandFirstRecord(page);
  await page.getByRole('button', { name: 'Play sound' }).click();
  await page.getByRole('button', { name: 'Pause sound' }).click();
  await expect(page.getByText(/^0:00 \/ 0:03$/)).toBeVisible();

  // Once the whole file is in, a refused seek changes nothing, so only the player can put the line right.
  const NETWORK_IDLE = 1;
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.networkState))
    .toBe(NETWORK_IDLE);
  const line = page.getByRole('slider', { name: 'Position in sound' });
  await line.focus();
  await page.keyboard.press('End');

  // The sound can't leave the start, so the line goes back there.
  await expect(line).toHaveValue('0');
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBe(0);
  await expect(page.getByText(/^0:00 \/ 0:03$/)).toBeVisible();
});

test('a sound that fails to load says so', async ({ page }) => {
  await page.route('https://sounds.example/**', (route) => route.fulfill({ status: 404 }));
  await expandFirstRecord(page);
  await page.getByRole('button', { name: 'Play sound' }).click();
  await expect(page.getByText("This sound couldn't be played.")).toBeVisible();
  await expect(page.getByRole('button', { name: /sound$/ })).toHaveCount(0);
});

test('the cell tooltip hides while the map is dragged', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'touch has no hover tooltip');
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0');
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const [centreX, centreY] = [box.x + box.width / 2, box.y + box.height / 2];
  const tooltip = page.getByTestId('map').getByText(/records?$/);
  // The cells load after the map does; keep nudging the pointer until one is under it.
  await expect(async () => {
    await page.mouse.move(centreX, centreY + 1);
    await page.mouse.move(centreX, centreY);
    await expect(tooltip).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.mouse.down();
  await page.mouse.move(centreX + 30, centreY, { steps: 5 });
  await expect(tooltip).toBeHidden();
  await page.mouse.move(centreX + 40, centreY, { steps: 3 });
  await expect(tooltip).toBeHidden();
  await page.mouse.up();
  await page.mouse.move(centreX + 41, centreY);
  await expect(tooltip).toBeVisible();
});

test('the When menu picks a preset, or a custom range typed or picked on the calendar', async ({ page }) => {
  await page.goto('/?taxon=2492462');
  await page.getByRole('button', { name: 'When', exact: true }).click();
  const menu = page.getByRole('button', { name: /^Date range:/ });
  await menu.click();
  await page.getByRole('button', { name: 'Last 5 years' }).click();
  await expect(page).toHaveURL(/when=5y/);
  await expect(menu).toHaveAccessibleName('Date range: Last 5 years');

  // Typed by month; a date that isn't one says what to type instead.
  await menu.click();
  await page.getByRole('button', { name: 'Custom range' }).click();
  const unit = (name: string) => page.locator('label', { has: page.getByRole('radio', { name }) }).click();
  await unit('Months');
  const from = page.getByRole('textbox', { name: 'From' });
  await from.fill('not a date');
  await from.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Try a date like Mar 2020.');
  await from.fill('Mar 2020');
  await from.press('Enter');
  const to = page.getByRole('textbox', { name: 'To' });
  await to.fill('June 2021');
  await to.press('Enter');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/when=m(%3A|:)2020-03\.\.2021-06/);
  await expect(menu).toHaveAccessibleName('Date range: Mar 2020 – Jun 2021');

  // A custom range reopens on its own view; by year, the calendar pages back a decade to pick both ends.
  await menu.click();
  await unit('Years');
  await page.getByRole('button', { name: 'Previous' }).click();
  await page.getByRole('button', { name: '2012', exact: true }).click();
  await page.getByRole('button', { name: '2016', exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/when=y(%3A|:)2012\.\.2016/);
  await expect(menu).toHaveAccessibleName('Date range: 2012–2016');
});
