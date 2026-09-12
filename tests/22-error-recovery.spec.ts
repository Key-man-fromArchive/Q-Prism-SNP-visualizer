import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('recent sessions distinguish failed list, empty list, and rejected opens with an accessible retry', async ({ page }) => {
  let listState = 'failed', openStatus = 404;
  await page.route('**/api/sessions', route => route.fulfill(listState === 'failed'
    ? { status: 500, json: { detail: 'private-secret' } }
    : { json: listState === 'empty' ? [] : [{ session_id: 'synthetic-missing', instrument: 'Synthetic', num_wells: 96,
      num_cycles: 40, uploaded_at: '2026-09-07T00:00:00Z', raw_filename: 'Synthetic recent' }] }));
  await page.route('**/api/sessions/synthetic-missing', route => route.fulfill({ status: openStatus, json: { detail: 'private-secret' } }));
  await login(page);
  const recent = page.getByRole('region', { name: /Recent sessions|최근 세션/i });
  await expect(recent.getByRole('alert')).toBeVisible();
  await expect(recent).not.toContainText(/No recent sessions|최근 세션이 없습니다/);
  listState = 'empty';
  await recent.getByRole('button', { name: /Retry list refresh|목록 새로고침 재시도/ }).click();
  await expect(recent).toContainText(/No recent sessions|최근 세션이 없습니다/);
  listState = 'ready'; await page.reload();
  for (const status of [403, 404, 500]) {
    openStatus = status;
    const response = page.waitForResponse(r => r.url().endsWith('/sessions/synthetic-missing') && r.status() === status);
    await recent.getByRole('button', { name: /Synthetic recent/ }).click(); await response;
    await expect(recent.getByRole('alert')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('private-secret');
    expect(new URL(page.url()).searchParams.get('session')).toBeNull();
  }
  openStatus = 401;
  await recent.getByRole('button', { name: /Synthetic recent/ }).click();
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('form').screenshot({ path: test.info().outputPath('recent-reauth.png') });
});

test('preset failure preserves input; successful save and failed refresh remain distinct without a repeated POST', async ({ page }) => {
  await login(page);
  await page.locator('#example-select').selectOption('2');
  await expect(page.locator('#cycle-slider')).toBeVisible();
  let posts = 0, failList = false;
  await page.route('**/api/presets', async route => {
    if (route.request().method() === 'POST') {
      posts++;
      if (posts === 1) return route.fulfill({ status: 500, json: { detail: 'private-secret' } });
      failList = true;
      return route.fulfill({ json: { id: 'synthetic', name: 'Keep this form', builtin: false, settings: {} } });
    }
    return route.fulfill(failList ? { status: 500, json: { detail: 'private-secret' } } : { json: { presets: [] } });
  });
  // Settings moved into the "More" overflow (P3-S1-T1); #tab-settings no
  // longer exists as a primary-row selector.
  await page.getByRole('button', { name: /^(More|더보기)$/ }).click();
  await page.getByRole('menuitem', { name: /^(Settings|설정)$/ }).click();
  await page.locator('#preset-name-input').fill('Keep this form');
  await page.locator('#save-preset-btn').click();
  await expect(page.getByRole('alert')).toContainText(/server|서버/);
  await expect(page.locator('#preset-name-input')).toHaveValue('Keep this form');
  await expect(page.locator('body')).not.toContainText('private-secret');
  await page.locator('#save-preset-btn').click();
  await expect(page.getByRole('status').filter({ hasText: /Preset saved|프리셋을 저장/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Retry list refresh|목록 새로고침 재시도/ })).toBeVisible();
  failList = false;
  await page.getByRole('button', { name: /Retry list refresh|목록 새로고침 재시도/ }).click();
  await expect(page.getByRole('button', { name: /Retry list refresh|목록 새로고침 재시도/ })).toHaveCount(0);
  expect(posts).toBe(2);
  await page.screenshot({ path: test.info().outputPath('preset-recovery.png'), fullPage: true });
});

test('partial uploads retain unknown outcomes across tabs, never auto-navigate/retry, and clear on logout', async ({ page }) => {
  await login(page);
  const example = await page.request.post('/api/examples', { data: { ploidy: 2 } });
  expect(example.ok()).toBe(true);
  const result = await example.json();
  let requests = 0;
  await page.route('**/api/upload', async route => {
    requests++;
    if (requests === 1) return route.fulfill({ json: result });
    if (requests === 2) return route.fulfill({ status: 500, json: { detail: 'private-secret' } });
    return route.abort('failed');
  });
  await page.locator('#file-input').setInputFiles(['success.eds', 'failed.eds', 'unknown.eds'].map(name => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic') })));
  await expect(page.getByText(/outcome is unknown|업로드 결과를 확인할 수 없습니다/)).toBeVisible();
  expect(requests).toBe(3);
  expect(new URL(page.url()).searchParams.get('tab')).not.toBe('project');
  await expect(page.locator('body')).not.toContainText('private-secret');
  await page.getByRole('button', { name: /Check sessions in Project|프로젝트에서 세션 확인/ }).click();
  await expect(page.locator('#tab-project')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#main-panel-project')).toBeVisible();
  await page.locator('#tab-library').click();
  await page.locator('#tab-project').click();
  await expect(page.getByText('unknown.eds', { exact: true })).toBeVisible();
  await expect(page.getByText('failed.eds', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Check sessions in Project|프로젝트에서 세션 확인/ }).click();
  expect(requests).toBe(3);
  await page.screenshot({ path: test.info().outputPath('upload-recovery.png'), fullPage: true });
  await page.getByRole('button', { name: /^(Logout|로그아웃)$/ }).click();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.getByText('unknown.eds', { exact: true })).toHaveCount(0);
});
