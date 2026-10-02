// P6: the scatter's axis orientation is an option. The default is the current
// view (FAM on x, VIC/HEX on y); "Swap axes" puts VIC/HEX on x and FAM on y, and
// the choice survives a reload because it is a persisted setting.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

const FAM = /FAM/;
const ALLELE2 = /VIC|HEX/;

test('swap axes flips the scatter axis titles and persists', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 });
  await login(page);
  await page.locator('#example-select').selectOption('2');
  await page.locator('#tab-results').click();

  const xTitle = page.locator('#scatter-plot .xtitle').first();
  const yTitle = page.locator('#scatter-plot .ytitle').first();
  await expect(xTitle).toHaveText(FAM);
  await expect(yTitle).toHaveText(ALLELE2);

  const toggle = page.getByTestId('scatter-swap-axes');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(xTitle).toHaveText(ALLELE2);
  await expect(yTitle).toHaveText(FAM);

  await page.reload();
  await page.locator('#tab-results').click();
  await expect(page.locator('#scatter-plot .xtitle').first()).toHaveText(ALLELE2);

  await page.getByTestId('scatter-swap-axes').click();
  await expect(page.locator('#scatter-plot .xtitle').first()).toHaveText(FAM);
});
