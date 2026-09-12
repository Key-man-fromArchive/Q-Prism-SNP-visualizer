import { expect, test, type Page } from '@playwright/test';
import { ADMIN_USERNAME, ADMIN_PASSWORD } from './helpers';
import AxeBuilder from '@axe-core/playwright';

async function mock384Geometry(page: Page) {
  // Transport fixture only: production parser geometry is deliberately unchanged.
  await page.route(/\/api\/data\/[^/]+\/(plate|scatter)(\?|$)/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    const key = new URL(route.request().url()).pathname.endsWith('/plate') ? 'wells' : 'points';
    const template = body[key][0];
    body[key] = [...'ABCDEFGHIJKLMNOP'].flatMap((row, r) => Array.from({ length: 24 }, (_, c) => ({
      ...template, well: `${row}${c + 1}`, row: r, col: c, sample_name: `Synthetic ${row}${c + 1}`,
      norm_fam: 1 + c / 24, norm_allele2: 1 + r / 16,
    })));
    await route.fulfill({ response, json: body });
  });
}

async function tabTo(page: Page, selector: string) {
  for (let i = 0; i < 100; i++) {
    if (await page.locator(selector).evaluateAll(nodes => nodes.includes(document.activeElement!))) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard cannot reach ${selector}`);
}

for (const wells of [96, 384]) test(`keyboard-only ${wells}-well tabs, grids, headers, menus, help and native editing`, async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  if (wells === 384) await mock384Geometry(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await tabTo(page, '#username');
  await page.keyboard.type('temporary');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('#username')).toHaveValue('');
  await page.keyboard.type(ADMIN_USERNAME);
  await page.keyboard.press('Tab');
  await page.keyboard.type(ADMIN_PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.locator('#example-select')).toBeVisible();
  // Synthetic fixture setup; the tested workflow below never uses a mouse.
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2');
  await analyzed;
  const cycle = page.locator('#cycle-slider');
  await expect(cycle).toBeVisible();
  const originalCycle = await cycle.inputValue();

  // P3-S1-T1 top-level order is plate, rawdata, results, quality, statistics,
  // compare, library, project; the default landing tab after analysis is
  // `results`, and `settings` moved into the "More" overflow (no longer part
  // of this roving-tabindex `role="tab"` list), so the reachable-by-arrow-keys
  // sequence below no longer stops at settings -- it exercises `quality` and
  // `statistics` instead, then returns to `results` via two more ArrowRights
  // (still keyboard-only) since `Home` always lands on the first tab (`plate`).
  await tabTo(page, '#tab-results');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-quality')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-statistics')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#tab-statistics')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.locator('#tab-plate')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-results')).toBeFocused();

  const first = page.locator('#plate-grid [data-well="A1"]');
  await expect(page.locator('#plate-grid [role="gridcell"]')).toHaveCount(wells);
  await expect(page.locator('#plate-grid button[role="rowheader"]')).toHaveCount(wells === 384 ? 16 : 8);
  await expect(page.locator('#plate-grid button[role="columnheader"]')).toHaveCount(wells === 384 ? 24 : 12);
  await tabTo(page, '#plate-grid [tabindex="0"]');
  await expect(first).toBeFocused();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#plate-grid [data-well="A2"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#plate-grid button[role="columnheader"]').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(first).toHaveAttribute('aria-selected', 'false');
  await expect(cycle).toHaveValue(originalCycle);

  await tabTo(page, '#results-plate [tabindex="0"]');
  await page.keyboard.press('Space');
  await expect(page.locator('#results-plate [data-well="A1"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#results-plate [data-well="A2"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  const modalAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(modalAxe.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#results-plate [data-well="A2"]')).toBeFocused();

  await tabTo(page, '#export-buttons button[aria-haspopup="menu"]');
  const trigger = page.locator('#export-buttons button[aria-haspopup="menu"]');
  await page.keyboard.press('Space');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(cycle).toHaveValue(originalCycle);
  const gridAxe = await new AxeBuilder({ page }).include('#plate-grid').include('#results-plate').analyze();
  await test.info().attach('grid-axe', { body: JSON.stringify(gridAxe.violations), contentType: 'application/json' });
  expect(gridAxe.violations.filter(item => item.impact === 'critical' || item.impact === 'serious').map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
  expect(errors).toEqual([]);
});
