import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

async function expectCategories(page: Page) {
  const plot = page.locator('#scatter-plot, [data-testid="marker-scatter"]');
  await expect.poll(() => plot.evaluate(node => {
    const plot = node as HTMLElement & { data?: { customdata?: string[]; marker?: { symbol?: string } }[] };
    return plot.data?.filter(trace => trace.customdata?.length).length ?? 0;
  })).toBeGreaterThan(2);
  const traces = await plot.evaluate(node => {
    const plot = node as HTMLElement & { data: { customdata?: string[]; name?: string; marker: { symbol: string; color: string; opacity: number; line: { width: number | number[] } } }[] };
    return plot.data.filter(trace => trace.customdata?.length).map(trace => ({ name: trace.name, ...trace.marker }));
  });
  expect(new Set(traces.map(trace => trace.symbol)).size).toBe(traces.length);
  expect(new Set(traces.map(trace => trace.color)).size).toBeGreaterThan(2);
  for (const trace of traces) expect(trace.opacity).toBe(1);
  expect(traces.some(trace => trace.symbol === 'cross')).toBe(true);
}

for (const language of ['en', 'ko']) for (const dark of [false, true]) {
  test(`chart meanings ${language} ${dark ? 'dark' : 'light'} single and marker`, async ({ page }) => {
    await page.addInitScript(({ language, dark }) => {
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language }, version: 0 }));
      localStorage.setItem('snp-analyzer-dark-mode', String(dark));
    }, { language, dark });
    await login(page);
    const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
    await page.locator('#example-select').selectOption('2'); await analyzed;
    await expect(page.locator('#plate-grid [data-well="A1"]')).toHaveAttribute('aria-label', /Homo|동형/);
    await page.reload();
    await expectCategories(page);
    await page.locator('#plate-grid [data-well="A1"]').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#plate-grid [data-well="A1"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('normalization-state')).toHaveAttribute('data-reported', 'true');
    await page.locator('.detail-panel details > summary').click();
    await expect(page.getByTestId('scatter-reading-basis')).toContainText(language === 'en' ? 'actually applied' : '실제 적용');
    await expect(page.locator('.detail-panel')).toContainText(language === 'en' ? 'Amplification curve normalization basis: unknown' : '증폭 곡선의 정규화 적용 기준: 미확인');
    await page.screenshot({ path: test.info().outputPath('single.png'), fullPage: true });
    await page.locator('#tab-plate').click();
    await page.getByTestId('add-marker-button').click();
    await page.getByTestId('marker-name-input').fill('Marker presentation');
    await page.getByTestId('marker-form-save').click();
    await page.getByTestId('col-header-1').click();
    await page.getByTestId('selection-bar').getByTestId('marker-pick-button').click();
    const saved = page.waitForResponse(response => response.url().endsWith('/markers') && response.request().method() !== 'GET');
    await page.getByTestId('assign-button').click(); await saved;
    await page.getByTestId('col-header-1').click();
    await page.getByTestId('add-marker-button').click();
    await page.getByTestId('marker-name-input').fill('Marker second');
    await page.getByTestId('marker-form-save').click();
    await page.getByTestId('col-header-2').click();
    await page.getByTestId('selection-bar').getByTestId('marker-pick-button').filter({ hasText: 'Marker second' }).click();
    const secondSaved = page.waitForResponse(response => response.url().endsWith('/markers') && response.request().method() !== 'GET');
    await page.getByTestId('assign-button').click(); await secondSaved;
    await page.locator('#tab-results').click();
    const markerAnalyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
    await page.getByTestId('multi-analyze-current').click(); await markerAnalyzed;
    await expectCategories(page);
    await page.screenshot({ path: test.info().outputPath('marker.png'), fullPage: true });
  });
}

test('unreported/raw basis and no-call remain distinct; reference warning and selection are redundant', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2'); await analyzed;
  await expect(page.locator('#plate-grid [data-well="A1"]')).toHaveAttribute('aria-label', /Homo/);
  let reported = true;
  // Presentation provenance fixtures only; RFU values and stored result remain unchanged.
  await page.route(/\/api\/data\/[^/]+\/(scatter|plate)(?:\?|$)/, async route => {
    const response = await route.fetch(); const body = await response.json();
    if (reported) body.normalization_applied = false;
    else delete body.normalization_applied;
    body.rox_outlier_wells = ['B1'];
    for (const point of body.points ?? body.wells ?? []) if (point.well === 'A1') { point.auto_cluster = null; point.manual_type = null; }
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.getByTestId('normalization-state')).toHaveAttribute('data-reported', 'true');
  await expect(page.getByTestId('normalization-state')).toContainText('no (reporter scale)');
  await expect(page.locator('#results-plate [data-well="A1"]')).toHaveAttribute('aria-label', /No displayed call/);
  await expect(page.locator('#results-plate [data-well="A1"]')).not.toHaveAttribute('aria-label', /No completed analysis/);
  await page.locator('#plate-grid [data-well="B1"]').focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#scatter-plot').evaluate(node => {
    const data = (node as HTMLElement & { data: { customdata?: string[]; text?: string[]; marker?: { line?: { width?: number[] } } }[] }).data;
    const trace = data.find(trace => trace.customdata?.includes('B1'));
    const index = trace?.customdata?.indexOf('B1') ?? -1;
    return { width: trace?.marker?.line?.width?.[index], text: trace?.text?.[index] };
  })).toMatchObject({ width: 3, text: expect.stringContaining('Reference-signal warning') });
  reported = false;
  await page.reload();
  await expect(page.getByTestId('normalization-state')).toHaveAttribute('data-reported', 'false');
  await expect(page.getByTestId('normalization-state')).toContainText('unknown');
  await page.screenshot({ path: test.info().outputPath('unknown-and-no-call.png'), fullPage: true });
});
