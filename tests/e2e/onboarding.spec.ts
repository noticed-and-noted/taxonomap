/** First-visit onboarding: the guided tour, then the "Try this" checklist. */
import { expect, test } from './fixtures';

test.use({ showTour: true });

test('the tour walks the map once, then hands over to the checklist', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/');
  const tour = page.getByRole('dialog', { name: 'Welcome to taxonomap' });
  await expect(tour).toContainText('A record is one find of one organism');
  await page.getByRole('button', { name: 'Start tour' }).click();

  for (const title of ['Every hex is a count', 'Inside a hex', 'Search', 'Filters', 'Beyond the map']) {
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    // The hex steps outline the hex, plus the legend or the cell panel.
    if (title === 'Every hex is a count' || title === 'Inside a hex') {
      await expect(page.locator('.tour-ring')).toHaveCount(2);
    }
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

  // Settings brings the tour back.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Restart tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to taxonomap' })).toBeVisible();
});
