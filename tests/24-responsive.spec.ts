import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('multi-marker 384 review keeps long context and warnings inside bounded regions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.locator('#example-select').selectOption('2');
  const names = ['Long marker identity '.repeat(4), 'Marker B', 'Marker C', 'Marker D'];
  await page.locator('#tab-plate').click();
  for (const [index, name] of names.entries()) {
    await page.getByTestId('add-marker-button').click();
    await page.getByTestId('marker-name-input').fill(name);
    await page.getByTestId('marker-ploidy-select').selectOption('2');
    await page.getByTestId('marker-form-save').click();
    await page.getByTestId(`col-header-${index * 2 + 1}`).click();
    await page.getByTestId(`col-header-${index * 2 + 2}`).click();
    await page.getByTestId('selection-bar').getByTestId('marker-pick-button').filter({ hasText: name }).click();
    await page.getByTestId('assign-button').click();
  }
  await page.locator('#tab-results').click();
  await expect(page.getByTestId('marker-selector-sidebar')).toBeVisible();
  await page.getByTestId('multi-analyze-current').click();
  await expect(page.getByTestId('marker-scatter').locator('.scatterlayer .point').first()).toBeVisible();
  // Presentation-only 384 geometry and warning fixture; saved scientific calls/context remain unchanged.
  await page.route(/\/api\/data\/[^/]+\/(plate|scatter)(\?|$)/, async route => {
    const response = await route.fetch(); const body = await response.json();
    const key = new URL(route.request().url()).pathname.endsWith('/plate') ? 'wells' : 'points';
    body[key] = [...'ABCDEFGHIJKLMNOP'].flatMap((row, r) => Array.from({ length: 24 }, (_, c) => ({
      ...body[key][0], well: `${row}${c + 1}`, row: r, col: c, sample_name: `Synthetic ${row}${c + 1}`,
    })));
    await route.fulfill({ response, json: body });
  });
  await page.route(/\/api\/data\/[^/]+\/cluster$/, async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.regions) for (const region of body.regions) region.warnings = Array.from({ length: 40 }, (_, i) => `Synthetic warning ${i}: review this marker independently.`);
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.locator('#plate-grid [role="gridcell"]')).toHaveCount(384);
  await expect(page.getByTestId('marker-selector-sidebar')).toContainText(names[0]);
  expect((await page.getByTestId('marker-selector-sidebar').boundingBox())!.height).toBeLessThanOrEqual(512);
  await expect(page.getByTestId('marker-warnings')).toContainText('Synthetic warning');
  await expect.poll(() => page.getByTestId('marker-warnings').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await expect.poll(() => page.getByTestId('plate-scroll-region').evaluate(node => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight)).toBe(true);
  await page.locator('#plate-grid [data-well="A1"]').click();
  await expect(page.locator('.detail-panel')).toContainText('Synthetic A1');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: test.info().outputPath('multi-marker-review.png'), fullPage: true });
});

test('result-first 96-well desktop keeps scatter, plate and selected summary in the initial viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2'); await analyzed;
  await expect(page.locator('#plate-grid [role="gridcell"]')).toHaveCount(96);
  await expect(page.locator('#scatter-plot .scatterlayer .point').first()).toBeVisible();
  await expect(page.getByTestId('analysis-result-status')).toContainText('Current conditions match');
  const cell = page.locator('#plate-grid [role="gridcell"]').first();
  await cell.focus(); await page.keyboard.press('Enter');
  await expect(cell).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.detail-panel')).toContainText('A1');
  for (const label of ['Sample', 'Genotype', 'Confidence']) {
    await expect(page.locator('.detail-panel tr').filter({ hasText: label }).first()).toBeVisible();
  }
  await expect(page.locator('.well-detail-expanded')).not.toHaveAttribute('open', '');
  for (const selector of ['#scatter-plot', '#plate-grid', '.detail-panel']) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
  }
  await expect(page.locator('[data-testid="analysis-advanced-settings"]')).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: test.info().outputPath('selected-result-first.png') });
  let analysisPosts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/(cluster|suggest-cycle)$/.test(request.url())) analysisPosts++; });
  const plot = page.locator('#scatter-plot');
  const originalPlot = await plot.elementHandle();
  const settings = page.getByTestId('analysis-advanced-settings');
  await settings.locator('summary').click();
  await expect(page.getByTestId('scatter-view-controls')).toBeVisible();
  await settings.locator('summary').click();
  expect(await plot.evaluate((node, original) => node === original, originalPlot)).toBe(true);
  // P12-PLOT-TOGGLE: the curve is a results-screen VIEW now (FB-12), not
  // something a well-detail disclosure ever contained -- switching to it is
  // the equivalent of P8-E2E-DEBT's "visible without expanding a
  // disclosure" guarantee in the new toggle structure (see
  // evidence/P12-PLOT-TOGGLE.md's "P8 guarantee" section).
  await page.getByTestId('plot-view-curve').click();
  await expect(page.locator('#amplification-plot .main-svg').first()).toBeVisible();
  // Switch back to scatter before the resize check below, which reads
  // #scatter-plot's own rendered width -- that is only meaningful while
  // the scatter view is the visible one.
  await page.getByTestId('plot-view-scatter').click();
  await page.setViewportSize({ width: 768, height: 1000 });
  await expect.poll(() => plot.locator('.svg-container').evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(768);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('header').getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /PNG/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  expect(analysisPosts).toBe(0);
});

for (const width of [390, 768, 1024, 1280, 1440]) {
  for (const language of ['ko', 'en']) {
    for (const dark of [false, true]) {
      test(`responsive header ${width} ${language} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript(({ language, dark }) => {
          localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language }, version: 0 }));
          localStorage.setItem('snp-analyzer-dark-mode', String(dark));
        }, { language, dark });
        await page.route('**/api/auth/login', async route => {
          const response = await route.fetch();
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, user: { ...body.user, display_name: '긴사용자이름_LongOperatorName_'.repeat(6) } } });
        });
        await page.route('**/api/sessions/*', async route => {
          const response = await route.fetch();
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, instrument: '긴실행이름_LongSessionIdentity_'.repeat(6) } });
        });
        await login(page);
        const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
        await page.locator('#example-select').selectOption('2');
        await analyzed;
        await expect(page.locator('#cycle-slider')).toBeVisible();
        const identity = await (await page.request.get('/api/auth/me')).json();
        const alias = 'ASG_UnbrokenAlias'.repeat(20);
        await page.route('**/api/auth/config', route => route.fulfill({ json: { auth_mode: 'asg_launch' } }));
        await page.route('**/api/auth/asg-launch-cookie', route => route.fulfill({ json: { ...identity,
          user: { ...identity.user, display_name: '긴사용자이름_LongOperatorName_'.repeat(6) },
          linked_context: { target_type: 'marker', target_id: 'LongContextIdentity'.repeat(10),
            context: { tag_alias: alias, marker_id: 'MarkerIdentity'.repeat(12) }, scope: ['snp:save_result'], expires_at: null },
        } }));
        let analysisPosts = 0;
        page.on('request', request => { if (request.method() === 'POST' && /\/(cluster|suggest-cycle)$/.test(request.url())) analysisPosts++; });
        await page.reload();
        await expect(page.locator('#cycle-slider')).toBeVisible();
        await expect(page.locator('.header-linked-context')).toContainText(alias);
        if (width < 1280) {
          const disclosure = page.locator('.header-linked-context summary');
          await disclosure.focus(); await page.keyboard.press('Enter');
          await expect(page.locator('.header-linked-context details')).toHaveAttribute('open', '');
        }
        await expect(page.locator('.header-linked-values .badge:visible')).toHaveText(alias);
        await expect(page.locator('#asg-save-result-btn')).toBeVisible();
        await expect(page.locator('header')).toBeVisible();
        await expect(page.locator('header')).toContainText('긴사용자이름_LongOperatorName_');
        await expect(page.locator('#instrument-badge')).toContainText('긴실행이름_LongSessionIdentity_');
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.locator('header').screenshot({ path: test.info().outputPath('expanded-header.png') });
        if (width < 1280) {
          await page.locator('.header-linked-context summary').press('Enter');
          await expect(page.locator('.header-linked-context details')).not.toHaveAttribute('open', '');
        }
        const actions = page.locator('header button:visible');
        for (const action of await actions.all()) {
          const bounds = await action.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        }
        const exportButton = page.locator('header').getByRole('button', { name: /^(Export|내보내기)$/ });
        await exportButton.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu', { name: /^(Export|내보내기)$/ });
        await expect(menu).toBeVisible();
        const menuBounds = await menu.boundingBox();
        expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
        expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
        await expect(menu.getByRole('menuitem')).toHaveCount(5);
        await page.keyboard.press('Escape');
        await expect(exportButton).toBeFocused();
        await expect(menu).not.toBeVisible();
        // P3-S1-T1: 8 top-level primary tabs (plate/rawdata/results/quality/
        // statistics/compare/library/project); the removed WorkspaceTabs
        // sub-navigation no longer adds 2 more (was 10 before the restructure).
        await expect(page.getByRole('tab')).toHaveCount(8);
        const more = page.getByRole('button', { name: /^(More|더보기)$/ });
        await more.focus(); await page.keyboard.press('Enter');
        // Overflow for an admin account (helpers.login uses the admin
        // credentials): Settings, References, Users, Feedback -- this
        // assertion was stale even before P3 (it predates the `feedback`
        // overflow tab added in 38fda85 and was never bumped from 2 to 3,
        // let alone the current 4).
        await expect(page.getByRole('menu', { name: /^(More|더보기)$/ }).getByRole('menuitem')).toHaveCount(4);
        await page.keyboard.press('Escape'); await expect(more).toBeFocused();
        const project = page.locator('header').getByRole('button', { name: /^\+ (Project|프로젝트)$/ });
        await project.focus(); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
        await page.keyboard.press('Escape'); await expect(project).toBeFocused();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
        // First primary tab in DOM order is now `plate` (not `results`),
        // since P3-S1-T1 removed the old `analysis` tab id entirely.
        const firstTab = page.locator('#tab-plate');
        await firstTab.focus();
        const primaryTabs = page.locator('.app-navigation [role="tab"]');
        for (let index = 1; index < await primaryTabs.count(); index++) {
          await page.keyboard.press('ArrowRight');
          await expect(primaryTabs.nth(index)).toBeFocused();
          await expect(primaryTabs.nth(index)).toHaveAttribute('aria-selected', 'true');
        }
        await page.keyboard.press('Home'); await expect(firstTab).toBeFocused();
        // `.analysis-grid` lives on the `results` surface, not `plate` (the
        // new first tab) -- return there (2 more ArrowRights: plate ->
        // rawdata -> results, still keyboard-only) so the panel is actually
        // rendered before reading its resolved grid-template-columns.
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tab-results')).toBeFocused();
        await expect.poll(() => page.locator('.analysis-grid').first().evaluate(node =>
          getComputedStyle(node).gridTemplateColumns.split(' ').length,
        )).toBe(width >= 1280 ? 2 : 1);
        expect(analysisPosts).toBe(0);
        await page.screenshot({ path: test.info().outputPath('responsive.png'), fullPage: true });
      });
    }
  }
}

test('384-well internal scrolling and short-height project dialog stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  // Geometry-only transport fixture, matching root20; no parser claim.
  await page.route(/\/api\/data\/[^/]+\/(plate|scatter)(\?|$)/, async route => {
    const response = await route.fetch();
    const body = await response.json();
    const key = new URL(route.request().url()).pathname.endsWith('/plate') ? 'wells' : 'points';
    body[key] = [...'ABCDEFGHIJKLMNOP'].flatMap((row, r) => Array.from({ length: 24 }, (_, c) => ({
      ...body[key][0], well: `${row}${c + 1}`, row: r, col: c, sample_name: `Synthetic ${row}${c + 1}`,
      norm_fam: 1 + c / 24, norm_allele2: 1 + r / 16,
    })));
    await route.fulfill({ response, json: body });
  });
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2'); await analyzed;
  await expect(page.locator('#plate-grid [role="gridcell"]')).toHaveCount(384);
  const scroll = page.getByTestId('plate-scroll-region');
  await expect(scroll).toHaveAttribute('tabindex', '0');
  await expect.poll(() => scroll.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await scroll.focus(); await expect(scroll).toBeFocused();
  const resultsScroll = page.getByTestId('results-scroll-region');
  await expect.poll(() => resultsScroll.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect.poll(() => resultsScroll.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await resultsScroll.focus(); await expect(resultsScroll).toBeFocused();
  await resultsScroll.screenshot({ path: test.info().outputPath('384-results-scroll.png') });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`, name: `Long synthetic project ${i}`, session_count: 0, created_at: '2026-09-07T00:00:00Z',
  })) } }));
  const trigger = page.locator('header').getByRole('button', { name: /^\+ (Project|프로젝트)$/ });
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /Long synthetic project 29/ })).toBeAttached();
  await expect.poll(() => dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await page.screenshot({ path: test.info().outputPath('short-dialog.png') });
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});
