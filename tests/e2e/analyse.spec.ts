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
