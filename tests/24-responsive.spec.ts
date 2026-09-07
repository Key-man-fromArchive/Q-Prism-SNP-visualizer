import { expect, test } from '@playwright/test';
import { login } from './helpers';

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
        await expect(page.getByRole('tab')).toHaveCount(10);
        const more = page.getByRole('button', { name: /^(More|더보기)$/ });
        await more.focus(); await page.keyboard.press('Enter');
        await expect(page.getByRole('menu', { name: /^(More|더보기)$/ }).getByRole('menuitem')).toHaveCount(2);
        await page.keyboard.press('Escape'); await expect(more).toBeFocused();
        const project = page.locator('header').getByRole('button', { name: /^\+ (Project|프로젝트)$/ });
        await project.focus(); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
        await page.keyboard.press('Escape'); await expect(project).toBeFocused();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
        const firstTab = page.locator('#tab-analysis');
        await firstTab.focus();
        const primaryTabs = page.locator('.app-navigation [role="tab"]');
        for (let index = 1; index < await primaryTabs.count(); index++) {
          await page.keyboard.press('ArrowRight');
          await expect(primaryTabs.nth(index)).toBeFocused();
          await expect(primaryTabs.nth(index)).toHaveAttribute('aria-selected', 'true');
        }
        await page.keyboard.press('Home'); await expect(firstTab).toBeFocused();
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
