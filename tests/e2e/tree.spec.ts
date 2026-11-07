import { expect, test } from './fixtures';

test('tree loads the baked levels and zooms via the keyboard-accessible list', async ({ page }) => {
  await page.goto('/tree');
  const animals = page.getByRole('button', { name: /^Animals/ });
  await expect(animals).toBeVisible();
  await animals.click();
  await expect(page).toHaveURL(/focus=1(&|$)/);
  await expect(page).not.toHaveURL(/taxon=/);
  await expect(page.getByRole('navigation', { name: 'Tree position' })).toContainText('Animals');
});

test('deep links lazy-load levels below order', async ({ page }) => {
  await page.goto('/tree?focus=729');
  await expect(page.getByRole('heading', { level: 2, name: 'Perching Birds' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Corvidae/ })).toBeVisible();
});

test('layout and metric live in the URL', { tag: '@mobile' }, async ({ page }, info) => {
  await page.goto('/tree');
  // Narrow screens default to the icicle, so switch to the other layout.
  const [label, value, chart] =
    info.project.name === 'mobile' ? ['Sunburst', 'sunburst', /Sunburst of/] : ['Icicle', 'icicle', /Icicle chart/];
  await page.getByText(label, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`layout=${value}`));
  await page.getByText('Species', { exact: true }).click();
  await expect(page).toHaveURL(/metric=species/);
  await page.reload();
  await expect(page.getByRole('img', { name: chart })).toHaveAttribute('aria-label', /sized by species/);
});

test('the hidden map waits until the map is shown', async ({ page }) => {
  const mapLibreRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('maplibre-gl')) mapLibreRequests.push(request.url());
  });
  await page.goto('/tree');
  await expect(page.getByRole('button', { name: /^Animals/ })).toBeVisible();
  expect(mapLibreRequests).toEqual([]);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
});

test('the groups list filters by common or scientific name', async ({ page }) => {
  await page.goto('/tree?focus=729');
  const details = page.getByRole('complementary', { name: 'Details' });
  const filter = details.getByRole('searchbox', { name: 'Filter groups' });
  await expect(details.getByRole('button', { name: /Corvidae/ })).toBeVisible();
  await filter.fill('thrush');
  await expect(details.getByRole('button', { name: /Turdidae/ })).toBeVisible();
  await expect(details.getByRole('button', { name: /Corvidae/ })).toHaveCount(0);
  await filter.fill('corvid');
  await expect(details.getByRole('button', { name: /Corvidae/ })).toBeVisible();
  await filter.fill('zzzz');
  await details.getByRole('button', { name: 'Clear filter' }).click();
  await expect(details.getByRole('button', { name: /Turdidae/ })).toBeVisible();
});

test('the chart shows a tip on hover, picks a group, zooms out from its centre and follows the breadcrumbs', async ({
  page,
}) => {
  await page.goto('/tree?focus=729');
  const chart = page.getByRole('img', { name: /^Sunburst of Perching Birds/ });
  await expect(chart).toBeVisible();
  // The chart tweens to its focus over most of a second, so arcs move under a pointer meanwhile: look for
  // a spot that is on an arc each time, and hover there.
  const arcPoint = () =>
    chart.evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      for (let radius = 60; radius < Math.min(box.width, box.height) / 2; radius += 10) {
        for (let angle = 0; angle < 360; angle += 15) {
          const pointX = box.left + box.width / 2 + radius * Math.cos((angle * Math.PI) / 180);
          const pointY = box.top + box.height / 2 + radius * Math.sin((angle * Math.PI) / 180);
          if (document.elementFromPoint(pointX, pointY)?.tagName === 'path') return { x: pointX, y: pointY };
        }
      }
      return null;
    });
  await expect(async () => {
    const point = await arcPoint();
    expect(point).not.toBeNull();
    await page.mouse.move(point!.x, point!.y);
    await page.mouse.move(point!.x + 1, point!.y);
    await expect(page.locator('[popover]')).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.mouse.down();
  await page.mouse.up();
  await page
    .getByRole('img', { name: /^Sunburst of/ })
    .locator('circle')
    .click({ force: true });
  // Wherever the pick went, the centre goes up a level and the breadcrumbs go home.
  await page.getByRole('navigation', { name: 'Tree position' }).getByRole('button').first().click();
  await expect(page).not.toHaveURL(/focus=/);

  // The icicle zooms out from its head column; on a narrow screen, from its head row. Without motion, it jumps.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tree?focus=729&layout=icicle');
  const icicle = page.getByRole('img', { name: /^Icicle chart of Perching Birds/ });
  await icicle.locator('g.cursor-pointer').first().click();
  await expect(page).not.toHaveURL(/focus=729/);
  // Back returns to the group; narrowing the window turns the icicle's head into a row.
  await page.goBack();
  await expect(page).toHaveURL(/focus=729/);
  await page.setViewportSize({ width: 500, height: 800 });
  await page
    .getByRole('img', { name: /^Icicle chart of Perching Birds/ })
    .locator('g.cursor-pointer')
    .first()
    .click();
  await expect(page).not.toHaveURL(/focus=729/);
  await page.setViewportSize({ width: 1280, height: 800 });

  // A click on one of the icicle's groups moves into it.
  await page.goto('/tree?focus=729&layout=icicle');
  await page
    .getByRole('img', { name: /^Icicle chart of Perching Birds/ })
    .locator('g.cursor-pointer')
    .nth(1)
    .click();
  await expect(page).not.toHaveURL(/focus=729/);
});

test('levels that fail to load say so, and a tree that fails altogether offers to try again', async ({ page }) => {
  await page.goto('/tree?focus=729');
  await expect(page.getByRole('button', { name: /Corvidae/ })).toBeVisible();
  await page.route(/\/v1\/species\//, (route) => route.fulfill({ status: 500, body: '' }));
  await page.route(/\/v1\/occurrence\//, (route) => route.fulfill({ status: 500, body: '' }));
  await page
    .getByRole('button', { name: /Corvidae/ })
    .first()
    .click();
  await expect(page.getByText('Some levels could not be loaded. Try again in a moment.')).toBeVisible();

  await page.route('**/data/tree.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/tree');
  await expect(page.getByText(/The tree data could not be loaded|GBIF is busy|Something went wrong/)).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
});

test('a link to a group GBIF does not know opens at the top, saying a level failed', async ({ page }) => {
  await page.goto('/tree?focus=99999999');
  await expect(page.getByRole('button', { name: /^Animals/ })).toBeVisible();
  await expect(page.getByText('Some levels could not be loaded. Try again in a moment.')).toBeVisible();
});

test('a group GBIF places outside the tree opens the tree at the top', async ({ page }) => {
  await page.route('**/v1/species/424242/parents', (route) => route.fulfill({ json: [] }));
  await page.goto('/tree?focus=424242');
  await expect(page.getByRole('button', { name: /^Animals/ })).toBeVisible();
});

test('the header search moves the tree to a group, and a selected group without a photo still shows', async ({
  page,
  context,
}) => {
  // Perching Birds' iNaturalist taxon, remembered from before; iNaturalist then fails, so it has no photo.
  await context.addInitScript(() => localStorage.setItem('inat-ids-v3', JSON.stringify([[729, 7251]])));
  await page.route(/\/inat\/v2\/taxa/, (route) => route.fulfill({ status: 400, body: '' }));
  await page.goto('/tree');
  const box = page.getByRole('combobox', { name: 'Search species or places' });
  await box.fill('corvidae');
  await page
    .getByRole('option', { name: /Corvidae/i })
    .first()
    .hover();
  await page.getByRole('button', { name: 'Show in tree' }).click();
  await expect(page).toHaveURL(/focus=5235/);
  await page.goto('/tree?focus=729');
  await page
    .getByRole('navigation', { name: 'Tree position' })
    .getByRole('button', { name: /Perching Birds/ })
    .click();
  await expect(page.getByRole('complementary', { name: 'Details' })).toContainText('Perching Birds');
});
