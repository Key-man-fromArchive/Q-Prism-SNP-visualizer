import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('independent project/library tabs restore directly and through history without session data requests', async ({ page }) => {
  await login(page);
  const dataRequests: string[] = [];
  page.on('request', request => { if (/\/api\/data\//.test(request.url())) dataRequests.push(request.url()); });
  await page.goto('/?tab=project');
  await expect(page.locator('#tab-project')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#tab-library').click();
  await expect.poll(() => new URL(page.url()).search).toBe('?tab=library');
  await page.goBack();
  await expect(page.locator('#tab-project')).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).search).toBe('?tab=project');
  await page.goForward();
  await expect(page.locator('#tab-library')).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).search).toBe('?tab=library');
  expect(dataRequests).toEqual([]);
});

test('fresh entry URL, reload and back/forward preserve the saved result without analysis', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2');
  const result = await (await analyzed).json();
  await expect(page.locator('#cycle-slider')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('session')).toBeTruthy();
  const session = new URL(page.url()).searchParams.get('session')!;
  expect([...new URL(page.url()).searchParams.keys()].sort()).toEqual(['cycle', 'marker', 'session', 'surface', 'tab']);
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/(cluster|suggest-cycle)(\?|$)/.test(request.url())) posts++; });
  // ROX normalisation now toggles from the checkbox on the scatter plot's
  // own header bar, not from Settings (P4-S2-T1, FB-04 §3-2/§3-3): Settings
  // keeps only a read-only status line at #rox-normalize-status.
  const rox = page.getByTestId('scatter-use-rox');
  await expect(rox).toBeVisible();
  await rox.uncheck();
  // Plate Setup is now a single top-level tab (`plate`) -- no more hopping
  // through a top-level "Analysis" tab into a nested Plate Setup sub-tab.
  await page.locator('#tab-plate').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('surface')).toBe('plate');
  await page.reload();
  await expect(page.locator('#tab-plate')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#tab-results').click();
  await expect(page.locator('#cycle-slider')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#tab-plate')).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page.locator('#tab-results')).toHaveAttribute('aria-selected', 'true');
  await expect(rox).not.toBeChecked();
  const saved = await (await page.request.get(`/api/data/${session}/cluster`)).json();
  expect(result.analysis_context.result_revision).toEqual(expect.any(String));
  expect(result.analysis_context.result_revision.length).toBeGreaterThan(0);
  expect(saved.analysis_context.result_revision).toBe(result.analysis_context.result_revision);
  expect(saved.assignments).toEqual(result.assignments);
  expect(posts).toBe(0);
  expect(errors).toEqual([]);
});

test('invalid cycle/marker fallback and not-found link show recoverable localized state', async ({ page }) => {
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2');
  await analyzed;
  await expect.poll(() => new URL(page.url()).searchParams.get('session')).toBeTruthy();
  const session = new URL(page.url()).searchParams.get('session')!;
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/(cluster|suggest-cycle)(\?|$)/.test(request.url())) posts++; });
  await page.goto(`/?session=${encodeURIComponent(session)}&tab=analysis&surface=analysis&marker=deleted&cycle=999999`);
  await expect(page.locator('#cycle-slider')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /일부 저장된|Some saved/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('cycle')).toBe('999999');
  await page.goto('/?session=missing-synthetic-run&cycle=0');
  await expect(page.getByRole('alert')).toContainText(/실행을 찾을 수|Run not found/);
  await expect(page.locator('#cycle-slider')).toHaveCount(0);
  expect(posts).toBe(0);
});
