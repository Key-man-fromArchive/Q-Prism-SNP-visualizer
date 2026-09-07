import { expect, test, type Page } from '@playwright/test';
import { login, ADMIN_USERNAME, ADMIN_PASSWORD } from './helpers';
import en from '../snp-analyzer/frontend/src/locales/en';
import ko from '../snp-analyzer/frontend/src/locales/ko';

for (const width of [390, 1024, 1440]) for (const language of ['en', 'ko'] as const) for (const theme of ['light', 'dark']) {
  test(`secondary forms ${width} ${language} ${theme}`, async ({ page }, testInfo) => {
    const t = language === 'en' ? en : ko;
    await page.setViewportSize({ width, height: 700 });
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language }, version: 0 }));
      localStorage.setItem('snp-analyzer-dark-mode', String(theme === 'dark'));
    }, { language, theme });
    await page.goto('/');
    await expect(page.locator('#username')).toHaveAttribute('autocomplete', 'username');
    await page.locator('#username').fill(ADMIN_USERNAME);
    await page.locator('#password').fill(ADMIN_PASSWORD);
    await page.locator('#password').press('Enter');
    await expect(page.locator('#file-input')).toBeAttached();
    await expect(page.getByTestId('quick-start-steps')).toBeVisible();
    const bounded = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await bounded();
    const help = page.getByRole('button', { name: t.importTemplatesHelpLabel });
    await help.click(); await expect(page.getByRole('tooltip')).toBeVisible();
    await help.focus(); await page.keyboard.press('Escape'); await page.keyboard.press('Space');
    await expect(page.getByRole('tooltip')).toBeVisible();
    const box = await page.getByRole('tooltip').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(help).toBeFocused();
    if (width === 390) {
      await page.setViewportSize({ width, height: 360 });
      await help.scrollIntoViewIfNeeded(); await help.press('Space');
      const shortBox = await page.getByRole('tooltip').boundingBox();
      expect(shortBox!.y).toBeGreaterThanOrEqual(0); expect(shortBox!.y + shortBox!.height).toBeLessThanOrEqual(360);
      await page.keyboard.press('Escape'); await expect(help).toBeFocused();
      await page.setViewportSize({ width, height: 700 });
    }
    await page.screenshot({ path: testInfo.outputPath('upload.png'), fullPage: true });
    const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
    await page.locator('#example-select').selectOption('2'); await analyzed;
    await page.route('**/api/presets', route => route.fulfill({ json: { presets: [{ id: 'long', name: 'Synthetic long preset '.repeat(12), builtin: true, settings: {} }] } }));
    await page.locator('#tab-settings').click();
    await expect(page.getByRole('combobox', { name: t.selectPreset })).toBeVisible();
    await page.locator('#preset-select').selectOption('long'); await bounded();
    await page.getByRole('textbox', { name: t.newPresetName }).fill('Synthetic long draft '.repeat(10));
    await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
    await page.locator('#tab-protocol').click();
    await expect(page.locator('#protocol-table input').first()).toBeVisible();
    await page.locator('#protocol-table input').first().fill('Long synthetic protocol label '.repeat(12));
    await page.getByRole('button', { name: t.cancel, exact: true }).click();
    await expect(page.locator('#protocol-table input').first()).not.toHaveValue(/Long synthetic/);
    await page.locator('#protocol-table input').first().press('Enter');
    await expect(page.getByRole('status').filter({ hasText: t.protocolSaved })).toBeVisible();
    await page.route(/\/api\/data\/[^/]+\/protocol$/, route => route.fulfill({ status: 500, json: { detail: 'private diagnostic must not render' } }), { times: 1 });
    await page.locator('#protocol-table input').first().press('Enter');
    await expect(page.getByRole('alert')).toContainText(t.errSaveProtocol);
    await expect(page.getByRole('alert')).not.toContainText('private diagnostic');
    await bounded();
    await page.screenshot({ path: testInfo.outputPath('protocol-error.png'), fullPage: true });
    await page.locator('#protocol-table input').first().press('Enter');
    await expect(page.getByRole('status').filter({ hasText: t.protocolSaved })).toBeVisible();
    await bounded();
    const region = page.getByRole('region', { name: t.pcrProtocolSteps });
    await region.focus(); await expect(region).toBeFocused();
    if (width === 390) expect(await region.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('protocol.png'), fullPage: true });
  });
}

async function curveFixture(page: Page) {
  // Deterministic warning transport only: the live example/session/plots remain real.
  await page.route(/\/api\/data\/[^/]+\/quality(?:\?|$)/, route => route.fulfill({ json: {
    results: Object.fromEntries(['A1', 'A2', 'P24'].map(well => [well, { well, score: 25,
      magnitude_score: 10, noise_score: 5, rise_score: 10, flags: ['weak_amplification'] }])),
    summary: { mean_score: 25, low_quality_count: 3, total_wells: 3 },
  } }));
}
async function openExample(page: Page) {
  await page.addInitScript(() => localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2');
  await analyzed;
  await expect(page.locator('#plate-grid [role="gridcell"]')).toHaveCount(96);
  await curveFixture(page);
}

test('keyboard curve jump temporarily reveals a group-hidden well and Return restores filters and focus', async ({ page }) => {
  await openExample(page);
  const first = page.locator('#plate-grid [data-well="A1"]');
  await first.focus(); await page.keyboard.press('Enter');
  await page.getByTestId('manual-group-1').click();
  await page.getByTestId('scatter-selected-only').click();
  await expect(page.getByTestId('scatter-selected-only')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#tab-quality').click();
  const movementPosts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') movementPosts.push(request.url()); });
  const target = page.locator('#main-panel-quality').getByRole('button', { name: 'A2', exact: true });
  await target.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('quality-navigation-notice')).toContainText('Temporary reveal: A2');
  await expect(page.locator('#plate-grid [data-well="A2"]')).toBeFocused();
  await expect(page.locator('.detail-panel')).toContainText('A2');
  await expect(page.getByTestId('scatter-selected-only')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('manual-group-1')).toHaveAttribute('aria-pressed', 'true');
  let analyses = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/cluster')) analyses++; });
  await page.getByRole('button', { name: 'Clear temporary reveal and return' }).click();
  await expect(page.locator('#tab-quality')).toBeFocused();
  await expect(page.getByTestId('quality-navigation-notice')).toHaveCount(0);
  await page.waitForTimeout(450); // Beyond the 220 ms analysis scheduler boundary.
  expect(analyses).toBe(0);
  expect(movementPosts).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('curve-return.png'), fullPage: true });
});

test('NTC jumps select another marker, preserve same-URL well history, and clear ephemeral state on reload', async ({ page }) => {
  await openExample(page);
  await page.getByTestId('workspace-tab-plate').click();
  for (const [column, name] of [[1, 'Marker A'], [2, 'Marker B']] as const) {
    await page.getByTestId('add-marker-button').click();
    await page.getByTestId('marker-name-input').fill(name);
    await page.getByTestId('marker-form-save').click();
    await page.getByTestId(`col-header-${column}`).click();
    await page.getByTestId('selection-bar').getByTestId('marker-pick-button').filter({ hasText: name }).click();
    const saved = page.waitForResponse(response => response.url().endsWith('/markers') && response.request().method() !== 'GET');
    await page.getByTestId('assign-button').click(); await saved;
    // Clear the previous column before selecting the next marker membership.
    await page.getByTestId(`col-header-${column}`).click();
  }
  await page.getByTestId('workspace-tab-analysis').click();
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.getByTestId('multi-analyze-current').click(); await analyzed;
  await page.route(/\/api\/data\/[^/]+\/qc(?:\?|$)/, async route => {
    const response = await route.fetch(); const data = await response.json();
    // Keep the actual server's captured/current revisions and conditions; only fix warning addresses.
    data.ntc_check.wells = ['A2', 'B2'].map(well => ({ well, signal: 7, flagged: true, reason: 'signal_above_threshold' }));
    data.ntc_check.status = 'warning'; data.ntc_check.ok = false;
    await route.fulfill({ response, json: data });
  });
  const refreshed = page.waitForResponse(response => /\/qc(?:\?|$)/.test(response.url()));
  await page.getByRole('button', { name: 'Refresh QC', exact: true }).click(); await refreshed;
  await expect(page.getByTestId('ntc-status')).toHaveAttribute('data-status', 'warning');
  await page.getByTestId('ntc-status').click();
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  const jump = async (well: string) => {
    const details = page.getByTestId('qc-details');
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    const button = page.getByRole('group', { name: 'Flagged NTC wells' }).getByRole('button', { name: well, exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    await expect(page.locator(`#plate-grid [data-well="${well}"]`)).toBeFocused();
    await expect(page.locator('.detail-panel')).toContainText(well);
    await expect(page.getByTestId('quality-navigation-notice')).toContainText('input revision');
  };
  await jump('A2');
  const markerValue = await page.getByTestId('marker-selector-dropdown').inputValue();
  await expect(page.getByTestId('marker-selector-dropdown').locator('option:checked')).toHaveText(/Marker B/);
  const firstUrl = page.url();
  await jump('B2');
  expect(page.url()).toBe(firstUrl);
  expect(new URL(page.url()).searchParams.has('well')).toBe(false);
  await page.goBack();
  await expect(page.locator('#plate-grid [data-well="A2"]')).toBeFocused();
  await page.goForward();
  await expect(page.locator('#plate-grid [data-well="B2"]')).toBeFocused();
  await expect(page.getByTestId('marker-selector-dropdown')).toHaveValue(markerValue);
  await page.waitForTimeout(450);
  expect(posts).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('ntc-marker-history.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('#plate-grid')).toBeVisible();
  await expect(page.getByTestId('quality-navigation-notice')).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('unassigned warning opens Plate Setup; an absent inventory target reports a safe state', async ({ page }) => {
  await openExample(page);
  await page.getByTestId('workspace-tab-plate').click();
  await page.getByTestId('add-marker-button').click();
  await page.getByTestId('marker-name-input').fill('Marker A');
  await page.getByTestId('marker-form-save').click();
  await page.getByTestId('well-A1').click();
  await page.getByTestId('selection-bar').getByTestId('marker-pick-button').filter({ hasText: 'Marker A' }).click();
  await page.getByTestId('assign-button').click();
  await page.locator('#tab-quality').click();
  const target = page.locator('#main-panel-quality').getByRole('button', { name: 'A2', exact: true });
  await target.focus(); await page.keyboard.press('Space');
  await expect(page.getByTestId('workspace-tab-plate')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('well-A2')).toBeFocused();
  await expect(page.getByTestId('well-inspector')).toContainText('A2');
  await page.getByRole('button', { name: 'Clear temporary reveal and return' }).click();
  await page.locator('#main-panel-quality').getByRole('button', { name: 'P24', exact: true }).click();
  await expect(page.getByTestId('quality-navigation-notice')).toContainText('no longer available');
  await expect(page.locator('#tab-quality')).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: test.info().outputPath('invalid-warning.png'), fullPage: true });
});
