import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

for (const theme of ['dark', 'light']) {
  for (const path of ['/', '/tree?focus=1', '/?near=1']) {
    test(`${path} has no axe violations in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
      await page.goto(path);
      await page.evaluate((value) => (document.documentElement.dataset['theme'] = value), theme);
      await expect(page.getByRole('heading', { level: 1 })).toBeAttached(); // islands hydrate after load
      // The WebGL canvas and third-party attribution are outside our control.
      const { violations } = await new AxeBuilder({ page }).exclude('.maplibregl-canvas-container').analyze();
      expect(
        violations.map(
          (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }
}
