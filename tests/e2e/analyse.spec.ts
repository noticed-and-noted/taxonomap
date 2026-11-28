/** Analyse mode journeys, against the fake world (see fixtures.ts). */
import { chooseMode, expect, test } from './fixtures';

test(
  'analyse opens with a species list that narrows as you type and opens a species in a view',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/');
    await chooseMode(page, 'Analyse');
    await expect(page).toHaveURL(/analyse=1/);

    const panel = page.getByRole('list', { name: 'Species' });
    await page.getByRole('searchbox', { name: 'Search species' }).fill('beetle');
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: 'Show spread for Harlequin ladybird' }).click();
    await expect(page).toHaveURL(/ak=4989904/);
    await expect(page).toHaveURL(/av=spread/);
    await expect(page.getByRole('tab', { name: 'Spread' })).toHaveAttribute('aria-selected', 'true');

    // Years is closed until opened; a preset keeps its range in the URL.
    await page.getByRole('button', { name: /Years/ }).click();
    await page.getByRole('button', { name: 'Last 10 years' }).click();
    await expect(page).toHaveURL(/ayr=\d{4}-\d{4}/);

    await page.getByRole('button', { name: 'Change species' }).click();
    await expect(page).not.toHaveURL(/ak=/);
    await expect(panel).toBeVisible();

    // Leaving Analyse leaves nothing of it in the URL.
    await chooseMode(page, 'Explore');
    await expect(page).not.toHaveURL(/analyse=1|ayr=/);
  },
);

test('migration shows records by month and steps through the year', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?analyse=1&ak=2490719');
  const months = page.getByRole('group', { name: 'Records by month' }).getByRole('button');
  await expect(months).toHaveCount(12);
  await expect(months.first()).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(months.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(months.last()).toHaveAttribute('aria-pressed', 'true');
  await months.nth(5).click();
  await expect(page).toHaveURL(/am=6/);

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(months.nth(6)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('spread shows cells first recorded by year and steps through the years', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?analyse=1&ak=2490719&av=spread&ayr=2015-2020');
  const years = page.getByRole('group', { name: 'Cells first recorded, by year' }).getByRole('button');
  await expect(years).toHaveCount(6);
  await expect(years.last()).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Next year' }).click();
  await expect(years.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/ay=2015/);
  await years.nth(2).click();
  await expect(page).toHaveURL(/ay=2017/);

  // Dragging along the bars moves through the years.
  const box = (await page.getByRole('group', { name: 'Cells first recorded, by year' }).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(years.last()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'About Spread' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('A cell counts once it has 2 records');
  await expect(page.getByRole('table', { name: 'First record in each country' })).toBeVisible();
  // Countries count every year, whatever the range: the fake world's records start in 1900.
  const countries = page.getByRole('table', { name: 'First record in each country' });
  const unitedKingdom = countries.getByRole('row').filter({ hasText: 'United Kingdom' });
  await expect(unitedKingdom).toContainText('1900');
  await countries.getByRole('button', { name: 'Records' }).click();
  await expect(countries.getByRole('columnheader', { name: 'Records' })).toHaveAttribute('aria-sort', 'descending');
  await countries.getByRole('button', { name: 'Country' }).click();
  await expect(countries.getByRole('row').nth(1)).toContainText('France');

  // A country moves the map to the species' records there.
  const view = new URL(page.url()).searchParams.get('view');
  await unitedKingdom.getByRole('button', { name: /Show United Kingdom on the map/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).not.toBe(view);
});

test(
  'typing searches every species in GBIF, with migration tags and the data credit',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/?analyse=1');
    const filter = page.getByRole('searchbox', { name: 'Search species' });
    await filter.fill('Turdus merula');
    // GBIF is searched as you type, below the picked species: no Enter needed.
    const row = page
      .getByRole('list', { name: 'More species in GBIF' })
      .getByRole('listitem')
      .filter({ hasText: 'Turdus merula' });
    await expect(row).toContainText('Migrates');
    await expect(page.getByText(/Encyclopedia of Life/)).toBeVisible();
  },
);

test("the years reach back to the species' earliest record", async ({ page }) => {
  await page.goto('/?analyse=1&ak=2490719');
  await page.getByRole('button', { name: /^Years/ }).click();
  // The fake world's records start in 1900; the default range starts in 2000.
  await expect(page.getByRole('slider', { name: 'First year included' })).toHaveAttribute('min', '1900');
  await page.getByRole('button', { name: 'All years' }).click();
  await expect(page).toHaveURL(/ayr=1900-\d{4}/);
  await expect(page.getByText(/takes a little longer to load/)).toBeVisible();
  await page.getByRole('button', { name: 'Since 2000' }).click();
  await expect(page).not.toHaveURL(/ayr=/);
});

test('both views can adjust for recording effort', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?analyse=1&ak=2490719');
  // Migration: the blackbird as a share of all birds' records, on the bars and the map's legend.
  await page.getByRole('checkbox', { name: 'Adjust for how many people record' }).check();
  await expect(page).toHaveURL(/ame=1/);
  await expect(page.getByRole('group', { name: 'Share of records by month' })).toBeVisible();
  await expect(page.getByText(/% of bird records/).first()).toBeVisible();

  // Spread: new cells per million records of everything that year.
  await page.getByRole('tab', { name: 'Spread' }).click();
  await page.getByRole('checkbox', { name: 'Adjust for how much is recorded' }).check();
  await expect(page).toHaveURL(/ase=1/);
  await expect(page.getByText(/per million records/).first()).toBeVisible();
});
