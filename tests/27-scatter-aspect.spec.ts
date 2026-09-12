// P4-S1-T1 (FB-04): the allele-discrimination plot was 300px tall on a 1920px
// screen because index.css declared .analysis-scatter-canvas twice inside the
// same 1280px media query — max-height:300px and height:360px both applied, and
// the cap won. Ratio is now bound by WIDTH (max-width derived from the height
// cap), so it holds instead of being sliced off. jsdom cannot measure layout,
// so this is the only place the fix is actually verified.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('scatter canvas honours the chosen aspect ratio at 1920x911', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 });
  await login(page);
  await page.locator('#example-select').selectOption('2');
  await page.locator('#tab-results').click();
  const canvas = page.locator('.analysis-scatter-canvas').first();
  await expect(canvas).toBeVisible();

  const read = async () => {
    const b = await canvas.boundingBox();
    return { w: Math.round(b!.width), h: Math.round(b!.height), ratio: +(b!.width / b!.height).toFixed(3) };
  };
  const four3 = await read();
  console.log('ASPECT 4:3 →', JSON.stringify(four3));

  await page.evaluate(() => {
    const raw = localStorage.getItem('snp-analyzer-settings');
    const s = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    s.state = { ...s.state, scatterAspect: '1:1' };
    localStorage.setItem('snp-analyzer-settings', JSON.stringify(s));
  });
  await page.reload();
  await page.locator('#tab-results').click();
  await expect(canvas).toBeVisible();
  const one1 = await read();
  console.log('ASPECT 1:1 →', JSON.stringify(one1));

  expect(Math.abs(four3.ratio - 4 / 3)).toBeLessThan(0.05);
  expect(four3.h).toBeGreaterThanOrEqual(600);
  expect(Math.abs(one1.ratio - 1)).toBeLessThan(0.05);
});
