import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
const undo = (page: Page) => page.getByRole('button', { name: /^(Undo|실행취소)$/ });
const redo = (page: Page) => page.getByRole('button', { name: /^(Redo|다시실행)$/ });
async function openRun(page: Page) {
  await login(page);
  const analyzed = page.waitForResponse(response => response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2');
  await analyzed;
  await expect(page.locator('#cycle-slider')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('session')).toBeTruthy();
  return new URL(page.url()).searchParams.get('session')!;
}
async function read(page: Page, sid: string) {
  const response = await page.request.get(`/api/data/${sid}/welltypes`);
  expect(response.ok()).toBe(true);
  return response.json();
}

test('keyboard multi-well edit, header undo, keyboard redo and reload preserve exact server state', async ({ page }) => {
  const sid = await openRun(page);
  const initial = await read(page, sid);
  const first = page.locator('#plate-grid [data-well="A1"]');
  await first.focus(); await page.keyboard.press('Space'); await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('1');
  await expect(undo(page)).toBeEnabled();
  const edited = await read(page, sid);
  expect(edited.manual_assignments).toEqual({ ...initial.manual_assignments, A1: 'NTC', A2: 'NTC' });
  expect(edited.input_revision).toBe(initial.input_revision + 1);
  await undo(page).click(); await expect(redo(page)).toBeEnabled();
  const restored = await read(page, sid);
  expect(restored.manual_assignments).toEqual(initial.manual_assignments);
  expect(restored.input_revision).toBe(edited.input_revision + 1);
  await first.focus(); await page.keyboard.press(`${primary}+Shift+z`);
  await expect(undo(page)).toBeEnabled();
  const repeated = await read(page, sid);
  expect(repeated.manual_assignments).toEqual(edited.manual_assignments);
  expect(repeated.input_revision).toBe(restored.input_revision + 1);
  await page.reload(); await expect(first).toBeVisible();
  await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeDisabled();
  expect((await read(page, sid)).manual_assignments).toEqual(edited.manual_assignments);
});

test('plate setup shares header history, failed undo retains pointer, conflict clears without retry', async ({ page }) => {
  const sid = await openRun(page);
  await page.getByTestId('workspace-tab-plate').click();
  await page.getByTestId('well-A1').click();
  await page.getByTestId('well-type-no-amp').click();
  await expect(undo(page)).toBeEnabled();
  const edited = await read(page, sid);
  expect(edited.manual_assignments.A1).toBe('Omit');
  let attempts = 0;
  await page.route(`**/api/data/${sid}/welltypes/bulk`, async route => {
    attempts++;
    await route.fulfill({ status: 500, json: { detail: 'synthetic private failure' } });
  });
  await undo(page).click();
  await expect(page.getByRole('status').filter({ hasText: /Manual change failed|수동 변경에 실패/ })).toBeVisible();
  await expect(undo(page)).toBeEnabled(); await expect(redo(page)).toBeDisabled();
  expect((await read(page, sid)).manual_assignments).toEqual(edited.manual_assignments);
  expect(attempts).toBe(1);
  await page.unroute(`**/api/data/${sid}/welltypes/bulk`);
  const external = await page.request.put(`/api/data/${sid}/welltypes/bulk`, {
    data: { assignments: { ...edited.manual_assignments, A2: 'NTC' }, expected_input_revision: edited.input_revision },
  });
  expect(external.ok()).toBe(true);
  await undo(page).click();
  await expect(page.getByRole('status').filter({ hasText: /History cleared|이력을 초기화/ })).toBeVisible();
  await expect(undo(page)).toBeDisabled(); await expect(redo(page)).toBeDisabled();
  expect((await read(page, sid)).manual_assignments).toEqual((await external.json()).manual_assignments);
  await page.screenshot({ path: test.info().outputPath('undo-conflict.png'), fullPage: true });
});
