/** The left rail's filter groups: each control writes its filter to the URL. */
import { expect, test } from './fixtures';

test('the What, Where and How groups write each filter to the URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'What', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Exact taxon only' }).check();
  await expect(page).toHaveURL(/exact=1/);
  // Each active filter has a chip that clears it.
  await page.getByRole('button', { name: 'Remove filter Exact taxon only' }).click();
  await expect(page).not.toHaveURL(/exact=/);
  await page.getByRole('checkbox', { name: /Endangered/ }).check();
  await expect(page).toHaveURL(/iucn=EN/);
  await page.getByRole('checkbox', { name: /Endangered/ }).uncheck();
  await expect(page).not.toHaveURL(/iucn=/);

  await page.getByRole('button', { name: 'Where', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Europe' }).check();
  await expect(page).toHaveURL(/continent=EUROPE/);
  await page.locator('label', { hasText: '≤ 100 m' }).click();
  await expect(page).toHaveURL(/uncert=100/);
  await page.locator('label', { hasText: 'Any' }).click();
  await expect(page).not.toHaveURL(/uncert=/);

  await page.getByRole('button', { name: /^How recorded/ }).click();
  await page.getByRole('checkbox', { name: 'Preserved specimen' }).check();
  await expect(page).toHaveURL(/basis=PRESERVED_SPECIMEN/);
  await page.getByRole('button', { name: 'Has photo', exact: true }).click();
  await page.getByRole('button', { name: 'Has sound', exact: true }).click();
  await expect(page).toHaveURL(/photo=1.*sound=1|sound=1.*photo=1/);

  await page.getByRole('button', { name: /^When/ }).click();
  await page.getByRole('button', { name: 'April' }).click();
  await expect(page).toHaveURL(/months=4/);
  await page.locator('fieldset', { hasText: 'Months' }).getByRole('button', { name: 'Clear' }).click();
  await expect(page).not.toHaveURL(/months=/);
});

test('the publisher search lists the biggest first, and picks by keyboard or pointer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^How recorded/ }).click();
  const box = page.getByRole('combobox', { name: 'Publisher' });
  const suggestions = page.getByRole('listbox', { name: 'Publisher suggestions' });

  // Focused with nothing typed, the biggest publishers are offered.
  await box.focus();
  await expect(suggestions.getByRole('option')).toHaveCount(3);
  await expect(suggestions.getByRole('option').first()).toContainText('iNaturalist.org');

  // Typed, the list narrows; the arrows move through it and Enter picks.
  await box.fill('garden');
  await expect(suggestions.getByRole('option')).toHaveCount(2);
  await box.press('ArrowDown');
  await box.press('ArrowDown');
  await box.press('ArrowUp');
  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Selected publishers' })).toContainText('Garden Bird Club');
  await expect(page).toHaveURL(/publisher=0a7a9a6b/);

  // One match left is picked by Enter alone; Escape clears what is typed.
  await box.fill('moth');
  await expect(suggestions.getByRole('option')).toHaveCount(1);
  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Selected publishers' })).toContainText('Garden Moth Survey');
  await box.fill('nothing like it');
  await expect(suggestions).toContainText('Nothing found');
  await box.press('Enter');
  await box.press('Escape');
  await expect(box).toHaveValue('');

  // A click picks too; a picked publisher is removed on its own, or all at once.
  await box.fill('inat');
  await suggestions.getByRole('option', { name: /iNaturalist/ }).hover();
  await suggestions.getByRole('option', { name: /iNaturalist/ }).click();
  await page.getByRole('button', { name: 'Remove iNaturalist.org' }).click();
  await expect(page.getByRole('list', { name: 'Selected publishers' })).not.toContainText('iNaturalist');
  await page.locator('fieldset', { hasText: 'Publisher' }).getByRole('button', { name: 'Clear' }).click();
  await expect(page).not.toHaveURL(/publisher=/);
});

test('a publisher search that fails says so', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/graphql' && url.search.includes('occurrencePublisherSuggest'),
    (route) => route.fulfill({ status: 500, body: '' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^How recorded/ }).click();
  await page.getByRole('combobox', { name: 'Publisher' }).fill('garden');
  await expect(page.getByText('Publisher search is unavailable. Try again shortly.')).toBeVisible();
});

test('a shared link names its publishers', async ({ page }) => {
  await page.goto('/?publisher=5b6c7d8e-9f01-4a2b-8c3d-4e5f60718293');
  await page.getByRole('button', { name: /^How recorded/ }).click();
  await expect(page.getByRole('list', { name: 'Selected publishers' })).toContainText('Garden Moth Survey');
});

test('the year histogram shows each year’s count, and a click or a handle sets the range', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^When/ }).click();
  const slider = page.getByRole('region', { name: 'Year range' });
  const chart = slider.getByRole('img', { name: /Histogram of records per year/ });
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2);
  await expect(page.getByText(/ · [\d,]+ records/)).toBeVisible();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  await expect(page.getByText(/ · [\d,]+ records/)).toBeHidden();

  // A click moves the nearer handle there; the view then zooms to the range, with a way back out.
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await expect(page).toHaveURL(/when=y/);
  await page.getByRole('button', { name: 'Zoom out to all years' }).click();
  await expect(page.getByRole('button', { name: 'Zoom out to all years' })).toBeHidden();
  const zoomedOut = (await chart.boundingBox())!;
  await page.mouse.click(zoomedOut.x + zoomedOut.width * 0.05, zoomedOut.y + zoomedOut.height / 2);
  await page.mouse.click(zoomedOut.x + zoomedOut.width * 0.99, zoomedOut.y + zoomedOut.height / 2);

  // The handles answer the keyboard, and the range is committed when they let go.
  const from = slider.getByRole('slider', { name: 'From year' });
  await from.focus();
  await from.press('ArrowRight');
  const to = slider.getByRole('slider', { name: 'To year' });
  await to.focus();
  await to.press('ArrowLeft');
  await expect(page).toHaveURL(/when=y/);
  await page.locator('fieldset', { hasText: 'Dates' }).getByRole('button', { name: 'Clear' }).first().click();
  await expect(page).not.toHaveURL(/when=/);
});

test('the date menu walks the calendar by keyboard and leaves its custom view several ways', async ({ page }) => {
  await page.goto('/?when=5y');
  await page.getByRole('button', { name: /^When/ }).click();
  const menu = page.getByRole('button', { name: /^Date range:/ });
  await menu.click();
  await page.getByRole('button', { name: /^Any time/ }).click();
  await expect(page).not.toHaveURL(/when=/);

  await menu.click();
  await page.getByRole('button', { name: 'Custom range' }).click();
  await page.locator('label', { has: page.getByRole('radio', { name: 'Days' }) }).click();
  const from = page.getByRole('textbox', { name: 'From' });
  await from.fill('not a date');
  await from.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  // The hint goes by itself.
  await expect(page.getByRole('alert')).toBeHidden({ timeout: 5000 });

  // The calendar's focused day moves with the arrows, a page at a time, and to the week's ends.
  const grid = page.locator('.date-picker .grid');
  await grid.locator('[tabindex="0"]').focus();
  for (const key of [
    'ArrowRight',
    'ArrowLeft',
    'ArrowDown',
    'ArrowUp',
    'PageDown',
    'PageUp',
    'Shift+PageUp',
    'Shift+PageDown',
    'Home',
    'End',
    'x',
  ]) {
    await page.keyboard.press(key);
  }
  // Zoomed out to months, then years, the same keys move by those.
  const title = page.locator('.date-picker .title');
  await title.click();
  await grid.locator('[tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  await title.click();
  // Next then Previous: the calendar's own paging (a decade at a time here).
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await grid.locator('[tabindex="0"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('End');
  // Picking a year goes back down to its months, then days.
  await grid.locator('[tabindex="0"]').click();
  await grid.locator('[tabindex="0"]').click();
  await grid.locator('[tabindex="0"]').click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Custom range' })).toBeHidden();

  // Back returns to the presets; Escape closes the menu.
  await menu.click();
  await page.getByRole('button', { name: 'Custom range' }).click();
  await page.locator('button.back').click();
  await page.getByRole('button', { name: 'Last 5 years' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Last 5 years' })).toBeHidden();
});

test('the What picker moves through its results by keyboard and clears its list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'What', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Species and groups' });
  await picker.fill('robin');
  await expect(page.getByRole('option').first()).toBeVisible();
  await picker.press('ArrowDown');
  await picker.press('ArrowDown');
  await picker.press('ArrowUp');
  await picker.press('Enter');
  await expect(page).toHaveURL(/taxon=/);
  await picker.fill('thrush');
  await picker.press('Escape');
  await expect(picker).toHaveValue('');
  // Enter with nothing found picks nothing.
  await picker.fill('zzzz');
  await picker.press('Enter');
  await picker.press('ArrowDown');
  await page.locator('.taxa-picker').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page).not.toHaveURL(/taxon=/);
});
