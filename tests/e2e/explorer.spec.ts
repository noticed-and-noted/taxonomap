/** Map explorer journeys, against the fake world (see fixtures.ts). */
import type { Locator, Page, Request } from '@playwright/test';
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

/** Empties the baked names, so every result is live, and holds its name lookup until the returned function is called. */
async function holdNameLookups(page: Page) {
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
  return release;
}

const heightOf = async (locator: Locator) => (await locator.boundingBox())?.height;

test('a live result holds its name’s place until iNaturalist answers, without moving', async ({ page }) => {
  const release = await holdNameLookups(page);
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search species or places' }).fill('robin');
  const robin = page.getByRole('option', { name: /Erithacus rubecula/i }).first();
  // An option's children are presentational, so the placeholder isn't in the accessibility tree there.
  const skeleton = robin.locator('.skeleton');
  await expect(skeleton).toBeVisible();
  await expect(robin).not.toContainText('European Robin');
  await robin.hover();
  const previewName = page
    .getByRole('region', { name: /^Preview/ })
    .locator('.body p')
    .first();
  await expect(previewName.locator('.skeleton')).toBeVisible();

  const rowHeight = await heightOf(robin);
  const previewNameHeight = await heightOf(previewName);
  const skeletonHeight = await heightOf(skeleton);
  release();
  await expect(skeleton).toHaveCount(0);

  await expect(page.getByRole('option', { name: /^European Robin/i }).first()).toBeVisible();
  expect(await heightOf(robin)).toBe(rowHeight);
  expect(await heightOf(previewName)).toBe(previewNameHeight);
  // As tall as the text: the row's 14 px, not its 20 px line.
  expect(skeletonHeight).toBe(14);
});

test('moving to another result cancels what the preview was still asking for', async ({ page }) => {
  await holdNameLookups(page);
  // The first row, the genus, is previewed; the robin itself asks the same way for its name.
  const isPreviewLookup = (request: Request) =>
    request.url().includes(`datasetKey=${INATURALIST_DATASET}`) &&
    request.url().includes('limit=1') &&
    !request.url().includes('taxonKey=2492462');
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search species or places' }).fill('robin');
  const asked = await page.waitForRequest(isPreviewLookup);
  const cancelled = page.waitForEvent('requestfailed', (request) => request.url() === asked.url());
  await page
    .getByRole('option', { name: /Erithacus rubecula/i })
    .first()
    .hover();
  await cancelled;
});

test('a live result in the What picker keeps its height when its name arrives', async ({ page }) => {
  const release = await holdNameLookups(page);
  await page.goto('/');
  await page.getByRole('button', { name: /^What/ }).click();
  await page.getByRole('combobox', { name: 'Species and groups' }).fill('robin');
  const robin = page.getByRole('option', { name: /Erithacus rubecula/i }).first();
  await expect(robin.locator('.skeleton')).toBeVisible();
  const rowHeight = await heightOf(robin);
  release();
  await expect(robin.locator('.skeleton')).toHaveCount(0);
  await expect(robin).toContainText('European Robin');
  expect(await heightOf(robin)).toBe(rowHeight);
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

test('in the cell’s records, the arrows step through rows and the lightbox steps through records', async ({ page }) => {
  await expandFirstRecord(page);
  const rows = page.getByRole('table', { name: 'Records' }).locator('tbody tr[data-record]');
  // Up from the first record has nowhere to go; down opens the next one.
  await rows.first().getByRole('button').first().focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1).getByRole('button').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first().getByRole('button').first()).toBeFocused();

  // The expanded record's photo opens a lightbox that steps on through the records.
  await page.getByRole('button', { name: /^Enlarge photo, 1 of/ }).click();
  const lightbox = page.getByRole('dialog');
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await lightbox.locator('img').first().click();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  // Down from the last loaded record loads the next page first.
  const shown = await rows.count();
  await rows.last().getByRole('button').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => rows.count()).toBeGreaterThan(shown);
  const loaded = await rows.count();
  await page.getByRole('button', { name: /^Show more/ }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(loaded);
});

test('the records’ species filter answers the arrow keys, Enter and Escape', async ({ page }) => {
  await page.goto('/?taxon=212&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await page.getByRole('tab', { name: 'Records' }).click();
  const search = page.getByRole('combobox', { name: 'Filter records by species' });
  await search.click();
  await search.press('ArrowDown');
  await search.press('ArrowUp');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(search).not.toHaveValue('');
  // Enter with nothing matching picks nothing.
  await search.fill('zzzz');
  await search.press('Enter');
  await expect(search).toHaveValue('zzzz');
});

test('the cell’s species table opens a row anywhere, sorts by records, and clears a search that matches nothing', async ({
  page,
}) => {
  // No taxon filter, so the cell holds several groups to filter by.
  await page.goto('/?view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  const table = page.locator('.species-table');
  await table.getByRole('button', { name: /^Records/ }).click();
  await table.getByRole('button', { name: /^Records/ }).click();
  await table.getByRole('searchbox', { name: 'Find in results' }).fill('zzzz');
  await table.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(table.getByRole('searchbox', { name: 'Find in results' })).toHaveValue('');
  await table.getByRole('button', { name: 'Filter' }).click();
  const filters = page.getByRole('dialog', { name: 'Filter species' });
  await filters.getByRole('button', { name: /^All/ }).click();
  await table.getByRole('button', { name: 'Filter' }).click();
  await page.keyboard.press('Escape');
  await expect(filters).toBeHidden();
  await table.getByRole('button', { name: 'Filter' }).click();
  await filters.getByRole('button', { name: 'Done' }).click();
  await expect(filters).toBeHidden();
  // A click on the row's count, not its link, still opens the species.
  const firstRow = table.locator('tbody tr').first();
  await firstRow.locator('td').last().click();
  await expect(page).toHaveURL(/\/species\//);
});

/** The map canvas, once its cells have loaded (a hover tooltip shows over the centre). */
async function mapWithCells(page: Page) {
  const canvas = page.locator('.maplibregl-canvas');
  const box = (await canvas.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await expect(async () => {
    await page.mouse.move(centre.x, centre.y + 1);
    await page.mouse.move(centre.x, centre.y);
    await expect(page.getByTestId('map').getByText(/records?$/)).toBeVisible({ timeout: 500 });
  }).toPass();
  return { canvas, box, centre };
}

test('a click or Enter on the map selects the cell there, and Escape or a click off the cells clears it', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'the keyboard and pointer paths are the same on phones');
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0');
  const { canvas, box, centre } = await mapWithCells(page);
  await page.mouse.click(centre.x, centre.y);
  await expect(page).toHaveURL(/hex=/);
  await expect(page.getByRole('heading', { name: 'Selected cell' })).toBeVisible();
  // Far out in the Atlantic there are no cells, so a click there clears the selection.
  await page.mouse.click(box.x + 5, box.y + box.height - 5);
  await expect(page).not.toHaveURL(/hex=/);

  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/hex=/);
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/hex=/);
});

test('a cell found to hold no records drops its count from the tooltip', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'touch has no hover tooltip');
  // No species falls under this taxon, so every cell's exact count comes back as 0.
  await page.goto('/?taxon=999999&view=-1.50,52.50,5.0');
  const canvas = page.locator('.maplibregl-canvas');
  const box = (await canvas.boundingBox())!;
  await expect(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('map').getByText(/records?$/)).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(page.getByTestId('map').getByText(/records?$/)).toBeHidden();
  // The next draw leaves the cell known to be empty out; panning makes sure one happens.
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).not.toHaveURL(/view=-1\.50%2C52\.50/);
});

test('an empty view offers to fly to the nearest records', async ({ page }) => {
  // Australia: the fake world's cells are all over Britain.
  await page.goto('/?taxon=2492462&view=135,-25,4');
  await expect(page.getByText(/Closest are about [\d,]+ km/)).toBeVisible();
  await page.getByRole('button', { name: 'Fly to nearest' }).click();
  await expect(page).not.toHaveURL(/view=135/);
});

test('a filter with no records anywhere offers to edit the filters', { tag: '@mobile' }, async ({ page }, info) => {
  // Empty tiles everywhere, the world grid included.
  await page.route(/\.mvt(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
  );
  await page.goto('/?taxon=2492462&basis=FOSSIL_SPECIMEN');
  await page.getByRole('button', { name: 'Edit filters' }).click();
  if (info.project.name === 'mobile') await expect(page).toHaveURL(/panel=filters/);
  else await expect(page.locator('#filter-flyout')).toBeVisible();
});

test('the header search steps with the arrows, switches to places and back, and opens a result’s page', async ({
  page,
}) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('european robin');
  await expect(page.getByRole('option', { name: /^European Robin/i }).first()).toBeVisible();
  await box.press('ArrowDown');
  await box.press('ArrowUp');
  // Ctrl+Shift+Enter switches what is searched, each way.
  await box.press('Control+Shift+Enter');
  await expect(page.getByRole('option', { name: /Search species for/ })).toBeVisible();
  await box.press('Control+Shift+Enter');
  await expect(page.getByRole('option', { name: /^European Robin/i }).first()).toBeVisible();
  // The preview's button picks the result in place.
  await page
    .getByRole('option', { name: /^European Robin/i })
    .first()
    .hover();
  await page.getByRole('button', { name: 'Filter on map' }).click();
  await expect(page).toHaveURL(/taxon=2492462/);
  // Ctrl+Enter opens the highlighted result's About page instead.
  await box.fill('common blackbird');
  await expect(page.getByRole('option', { name: /^Common Blackbird/i }).first()).toBeVisible();
  await box.press('Control+Enter');
  await expect(page).toHaveURL(/\/species\//);
});

test('a pick past the What list’s limit says why it was not added', async ({ page }) => {
  await page.goto('/?taxon=1,2,3,4,5,6,7,8,9,10');
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('european robin');
  await page
    .getByRole('option', { name: /^European Robin/i })
    .first()
    .click();
  await expect(page.getByText('You can show up to 10 species or groups.', { exact: false }).first()).toBeVisible();
});

test('the legend slides away and back, and the cell panel closes to no selection', async ({ page }) => {
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await page.getByRole('button', { name: 'Slide legend away' }).click();
  await page.getByRole('button', { name: 'Show legend' }).click();
  await expect(page.getByRole('button', { name: 'Slide legend away' })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page).not.toHaveURL(/hex=/);
});

test('open filters move between the rail and the sheet as the window crosses the phone width', async ({ page }) => {
  await page.goto('/?taxon=2492462');
  await page.getByRole('button', { name: 'When', exact: true }).click();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page).toHaveURL(/panel=filters/);
  // The sheet clears every filter in one go.
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page).not.toHaveURL(/taxon=/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page).not.toHaveURL(/panel=filters/);
  await expect(page.locator('#filter-flyout')).toBeVisible();
  // Crossing back with nothing open moves nothing.
  await page.getByRole('button', { name: 'When', exact: true }).click();
  await expect(page.locator('#filter-flyout')).toBeHidden();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page).not.toHaveURL(/panel=filters/);
});

test('busy GBIF tiles raise a notice that can be dismissed, and failed tiles say so', async ({ page }) => {
  await page.route(/\.mvt(\?|$)/, (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/?taxon=2492462');
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  await expect(dismiss).toBeVisible();
  // Once GBIF answers again, the notice stays dismissed.
  await page.unroute(/\.mvt(\?|$)/);
  await dismiss.click();
  await expect(page.getByText('GBIF is busy.')).toBeHidden();

  await page.route(/\.mvt(\?|$)/, (route) => route.abort('failed'));
  await page.goto('/?taxon=212');
  await expect(page.getByText('Occurrence tiles are unavailable right now.')).toBeVisible();
});

test('the request meter, with ?debug=requests, hides and shows with Ctrl+D and remembers it', async ({ page }) => {
  await page.goto('/?debug=requests');
  const meter = page.getByText(/GBIF requests · \d+ min/);
  await expect(meter).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(meter).toBeHidden();
  await page.keyboard.press('d');
  await page.reload();
  await page.waitForTimeout(500);
  await expect(meter).toBeHidden();
  await page.keyboard.press('Control+d');
  await expect(meter).toBeVisible();
});

test('a record list that fails to load offers to try again', async ({ page }) => {
  let isDown = true;
  await page.route(/\/v1\/occurrence\/search\?.*limit=(?!0\b)\d+/, (route) =>
    isDown ? route.fulfill({ status: 500, body: '' }) : route.fallback(),
  );
  await page.goto('/?taxon=212&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  await page.getByRole('tab', { name: 'Records' }).click();
  const alert = page.getByRole('alert').filter({ hasText: /records/i });
  await expect(alert).toBeVisible();
  isDown = false;
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('table', { name: 'Records' }).locator('tbody tr').first()).toBeVisible();
});

test('a photo GBIF’s image cache misses at first is asked for again', async ({ page }) => {
  const asked = new Map<string, number>();
  await page.route(/\/v1\/image\/cache\//, (route) => {
    const url = route.request().url();
    asked.set(url, (asked.get(url) ?? 0) + 1);
    return asked.get(url) === 1 ? route.fulfill({ status: 500, body: '' }) : route.fallback();
  });
  await expandFirstRecord(page);
  await expect.poll(() => Math.max(0, ...asked.values())).toBeGreaterThan(1);
});

test('a search box’s own clear button empties it', async ({ page }) => {
  await page.goto('/tree?focus=729');
  const filter = page.getByRole('searchbox', { name: 'Filter groups' });
  await filter.fill('thrush');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(filter).toHaveValue('');
});

test('a live search result’s preview counts its records when its photo search could not', async ({ page }) => {
  // No baked names, so every result is a live one without a count.
  await page.route('**/data/names.json', (route) =>
    route.fulfill({ json: { v: 1, generated: '2026-01-01T00:00:00Z', names: [] } }),
  );
  await page.route(/\/graphql/, (route) => route.fulfill({ status: 500, body: '' }));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search species or places' }).fill('robin');
  await page
    .getByRole('option', { name: /Erithacus rubecula/i })
    .first()
    .hover();
  await expect(page.getByRole('region', { name: /^Preview/ }).getByText(/records/)).toBeVisible();
});
