import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

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
