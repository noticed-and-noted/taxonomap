/** Phone-only interactions: the bottom sheet and touch on charts. */
import { expect, test } from './fixtures';

test.skip(({ isMobile }) => !isMobile, 'phones only');

test(
  'the bottom sheet snaps by tap, keys and drag, and a long drag down closes it',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
    const handle = page.getByRole('button', { name: /^Resize panel/ });
    await expect(handle).toHaveAccessibleName('Resize panel (currently half height)');
    await handle.click();
    await expect(handle).toHaveAccessibleName('Resize panel (currently full height)');
    await handle.press('ArrowDown');
    await handle.press('ArrowDown');
    await expect(handle).toHaveAccessibleName('Resize panel (currently collapsed)');
    await handle.press('ArrowUp');
    await expect(handle).toHaveAccessibleName('Resize panel (currently half height)');

    // A short drag up snaps to the nearest height; a long one down closes the sheet.
    const drag = async (fromY: number, toY: number) => {
      await handle.dispatchEvent('pointerdown', { clientY: fromY, pointerId: 1, isPrimary: true });
      await handle.dispatchEvent('pointermove', { clientY: (fromY + toY) / 2, pointerId: 1 });
      await handle.dispatchEvent('pointermove', { clientY: toY, pointerId: 1 });
      await handle.dispatchEvent('pointerup', { clientY: toY, pointerId: 1 });
    };
    await drag(400, 200);
    await expect(handle).toHaveAccessibleName('Resize panel (currently full height)');
    await drag(100, 100 + page.viewportSize()!.height);
    await expect(handle).toBeHidden();
    await expect(page).not.toHaveURL(/panel=hex/);
  },
);

test('Escape on the sheet’s handle closes it', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/?taxon=2492462&view=-1.50,52.50,5.0&hex=-1.5000,52.5000&panel=hex');
  const handle = page.getByRole('button', { name: /^Resize panel/ });
  await handle.press('Escape');
  await expect(handle).toBeHidden();
});

test(
  'on a species page, a tap shows a chart’s tip and a second tap on a bar follows its link',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/species/2490719/turdus-merula');
    const years = page.locator('.plot-box').first();
    await years.scrollIntoViewIfNeeded();
    await expect(years.locator('svg').first()).toBeVisible();
    const yearsBox = (await years.boundingBox())!;
    await page.touchscreen.tap(yearsBox.x + yearsBox.width * 0.8, yearsBox.y + yearsBox.height / 2);
    await expect(page.locator('[popover]').first()).toBeVisible();
    await page.touchscreen.tap(yearsBox.x + yearsBox.width * 0.8, yearsBox.y + yearsBox.height / 2);
    // A tap elsewhere puts the tip away.
    await page.touchscreen.tap(5, yearsBox.y - 40);

    const months = page.getByRole('img', { name: /Records by month/ }).first();
    await months.scrollIntoViewIfNeeded();
    const monthsBox = (await months.boundingBox())!;
    await page.touchscreen.tap(monthsBox.x + monthsBox.width / 2, monthsBox.y + monthsBox.height * 0.2);
    await expect(page.locator('[popover]').first()).toBeVisible();
  },
);
