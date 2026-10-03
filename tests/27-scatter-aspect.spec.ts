// P4-S1-T1 (FB-04) / P9: the allele-discrimination plot is bound by WIDTH for the
// fixed ratios (4:3, 3:4) and fills the card for the default `fill`. jsdom cannot
// measure layout, so this is the only place the CSS is actually verified.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('scatter canvas fills the card by default and honours 4:3 / 3:4 / legacy 1:1 at 1920x911', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 });
  await login(page);
  await page.locator('#example-select').selectOption('2');
  await page.locator('#tab-results').click();
  const canvas = page.locator('.analysis-scatter-canvas').first();
  await expect(canvas).toBeVisible();

  const read = async () => {
    const b = await canvas.boundingBox();
    const parent = await canvas.evaluate((el) => el.parentElement!.getBoundingClientRect().width);
    return { w: Math.round(b!.width), h: Math.round(b!.height), ratio: +(b!.width / b!.height).toFixed(3), parent: Math.round(parent) };
  };
  const setAspect = async (scatterAspect: string, version: number) => {
    await page.evaluate(([value, v]) => {
      const raw = localStorage.getItem('snp-analyzer-settings');
      const s = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      s.state = { ...s.state, scatterAspect: value };
      s.version = v;
      localStorage.setItem('snp-analyzer-settings', JSON.stringify(s));
    }, [scatterAspect, version] as const);
    await page.reload();
    await page.locator('#tab-results').click();
    await expect(canvas).toBeVisible();
  };

  const fill = await read();
  console.log('ASPECT fill →', JSON.stringify(fill));
  expect(fill.w).toBeGreaterThanOrEqual(fill.parent - 40);
  expect(fill.h).toBeGreaterThanOrEqual(320);

  await setAspect('3:4', 3);
  const three4 = await read();
  console.log('ASPECT 3:4 →', JSON.stringify(three4));
  expect(Math.abs(three4.ratio - 3 / 4)).toBeLessThan(0.05);

  await setAspect('4:3', 3);
  const four3 = await read();
  console.log('ASPECT 4:3 →', JSON.stringify(four3));
  expect(Math.abs(four3.ratio - 4 / 3)).toBeLessThan(0.05);

  // A stored 1:1 from the previous settings version migrates to fill.
  await setAspect('1:1', 2);
  await expect(page.getByTestId('scatter-aspect-select')).toHaveValue('fill');
  const migrated = await read();
  expect(migrated.w).toBeGreaterThanOrEqual(migrated.parent - 40);
});
