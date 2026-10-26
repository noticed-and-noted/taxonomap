/** First-visit onboarding: the guided tour, then the "Try this" checklist. */
import { expect, test } from './fixtures';

test.use({ showTour: true });

test('the tour walks the map once, then hands over to the checklist', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/');
  const tour = page.getByRole('dialog', { name: 'Welcome to Taxonomap' });
  await expect(tour).toContainText('A record is one find of one organism');
  await page.getByRole('button', { name: 'Start tour' }).click();

  for (const title of ['Every hex is a count', 'Inside a hex', 'Search', 'Filters', 'Beyond the map']) {
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    // The hex steps outline the hex, plus the legend or the cell panel.
    if (title === 'Every hex is a count' || title === 'Inside a hex') {
      await expect(page.locator('.spotlight-ring')).toHaveCount(2);
    }
    // The last step has nothing left to skip.
    await expect(page.getByRole('button', { name: 'Skip' })).toHaveCount(title === 'Beyond the map' ? 0 : 1);
    await page.getByRole('button', { name: title === 'Beyond the map' ? 'Done' : 'Next' }).click();
  }

  // The tour's own hex is cleared, and the checklist takes over.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/hex=/);
  await expect(page.getByRole('region', { name: 'Try this' })).toContainText('0 of 7');

  await page.reload();
  await expect(page.getByRole('region', { name: 'Try this' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('skipping the tour leaves the checklist, which ticks itself', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip' }).click();
  const checklist = page.getByRole('region', { name: 'Try this' });
  await expect(checklist).toContainText('Next: Find a species by name');

  await page.getByRole('button', { name: /^Switch to (light|dark) theme$/ }).click();
  await expect(checklist).toContainText('1 of 7');
  await checklist.getByRole('button', { name: /^Try this/ }).click();
  await expect(checklist.getByText('Make it yours (done)')).toBeVisible();

  await page.getByRole('button', { name: 'Hide Try this' }).click();
  await expect(checklist).toHaveCount(0);

  // Settings brings back the checklist, then the tour.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Show Try this' }).click();
  await expect(checklist).toContainText('1 of 7');
  await expect(page.getByRole('button', { name: 'Show Try this' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restart tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Taxonomap' })).toBeVisible();
});

test('an item’s help spotlights where to click, and lets the click through', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip' }).click();
  const checklist = page.getByRole('region', { name: 'Try this' });
  await checklist.getByRole('button', { name: /^Try this/ }).click();

  await page.getByRole('button', { name: 'Show me where: Filter to a decade' }).click();
  const hint = page.getByRole('dialog', { name: 'Filter to a decade' });
  await expect(hint).toContainText('Open the When filter');
  await expect(page.locator('.spotlight-ring')).toHaveCount(1);

  // The highlighted rail button still works: clicking it opens When and puts the hint away.
  await page.getByRole('button', { name: 'When', exact: true }).click();
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'When' })).toBeVisible();

  // Escape closes a hint without doing anything.
  await page.getByRole('button', { name: 'Hide When filters' }).click();
  await page.getByRole('button', { name: 'Show me where: Find a species by name' }).click();
  await expect(page.getByRole('dialog', { name: 'Find a species by name' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('turning on a group tile ticks “Narrow to one group”', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip' }).click();
  const checklist = page.getByRole('region', { name: 'Try this' });
  await expect(checklist).toContainText('0 of 7');

  await page.getByRole('button', { name: 'What', exact: true }).click();
  await page.getByRole('button', { name: 'Birds', exact: true }).click();
  await expect(checklist).toContainText('1 of 7');
  await page.getByRole('button', { name: 'Hide What filters' }).click();
  await checklist.getByRole('button', { name: /^Try this/ }).click();
  await expect(checklist.getByText('Narrow to one group (done)')).toBeVisible();
});

test('finishing the last item grows the fern, then the list is gone for good', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('try-this', JSON.stringify(['search', 'hex', 'when', 'group', 'near', 'tree'])),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip' }).click();
  const checklist = page.getByRole('region', { name: 'Try this' });
  await expect(checklist).toContainText('6 of 7');

  await page.getByRole('button', { name: /^Switch to (light|dark) theme$/ }).click();
  await expect(checklist.getByRole('status')).toContainText("You've found your way around");
  await checklist.getByRole('button', { name: 'Close' }).click();
  await expect(checklist).toHaveCount(0);

  // Settings starts it over: the only way back to a finished list.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Reset Try this' }).click();
  await expect(checklist).toContainText('0 of 7');
});

test('Near me keeps the checklist and the legend, and ticks the list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Near me' }).click();
  const checklist = page.getByRole('region', { name: 'Try this' });
  await expect(checklist).toContainText('1 of 7');
  await expect(page.getByText('Records per cell')).toBeVisible();
});
