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
    await page.getByRole('searchbox', { name: 'Filter species' }).fill('beetle');
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
