import { expect, test } from '@playwright/test';
import { login } from './helpers';
import type { QcResponse } from '../snp-analyzer/frontend/src/types/api';

// Uses authenticated synthetic data; injected QC states test presentation, not scientific thresholds.
for (const language of ['en', 'ko'] as const) {
  test(`QC status matrix and separate unavailable wells (${language})`, async ({ page }) => {
    await page.addInitScript(lang => localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: lang }, version: 0 })), language);
    let status: QcResponse['ntc_check']['status'] = 'warning';
    await page.route('**/api/data/*/qc?*', async route => {
      const response = await route.fetch();
      const data: QcResponse = await response.json();
      data.ntc_check = { ...data.ntc_check, status, ok: status === 'ok', wells: status === 'no_ntc' ? [] : [
        { well: 'A1', signal: 7, flagged: status === 'warning', reason: status === 'warning' ? 'signal_above_threshold' : 'none' },
        { well: 'A2', signal: null, flagged: null, reason: 'missing_signal' },
      ] };
      await route.fulfill({ response, json: data });
    });
    await login(page);
    await page.locator('#example-select').selectOption('2');
    const summary = page.getByTestId('ntc-status');
    await expect(summary).toHaveAttribute('data-status', 'warning');
    for (const next of ['ok', 'warning', 'no_ntc', 'insufficient'] as const) {
      status = next;
      await page.getByRole('button', { name: language === 'en' ? 'Refresh QC' : 'QC 새로고침' }).click();
      await expect(summary).toHaveAttribute('data-status', next);
      const labels = language === 'en'
        ? { ok: 'NTC normal', warning: 'NTC warning', no_ntc: 'No NTC', insufficient: 'NTC evaluation insufficient' }
        : { ok: 'NTC 정상', warning: 'NTC 경고', no_ntc: 'NTC 없음', insufficient: 'NTC 측정 불충분' };
      await expect(summary).toContainText(labels[next]);
    }
    status = 'warning';
    await page.getByRole('button', { name: language === 'en' ? 'Refresh QC' : 'QC 새로고침' }).click();
    await expect(summary).toHaveAttribute('data-status', 'warning');
    await summary.click();
    const flagged = page.getByRole('group', { name: language === 'en' ? 'Flagged NTC wells' : '경고 NTC 웰' });
    await expect(flagged).toContainText('A1');
    await expect(flagged).not.toContainText('A2');
    await expect(page.getByRole('group', { name: language === 'en' ? 'Unevaluable NTC wells' : '평가 불가 NTC 웰' })).toContainText('A2');
  });
}
