import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { login } from './helpers';

const QS_DIR = '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/Quantstudio3';
const CFX_DIR = '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/CFX-opus';

/**
 * A file the parsers cannot use is rejected per file in the upload-results
 * panel, not as inline parser text: `lib/recovery-reason.ts` maps the failure
 * to a fixed public reason code precisely so server messages never become UI
 * copy. Language-independent, since the app defaults to Korean.
 */
async function expectRejected(page: Page) {
  const status = page.locator('#upload-status');
  await expect(status).toContainText(
    /Upload attempt finished|업로드 시도가 끝났습니다/,
    { timeout: 15000 },
  );
  const results = page.getByRole('region', { name: /Upload results|업로드 결과/ });
  await expect(results).toContainText(/Rejected|요청 실패/);
  await expect(results.getByRole('alert')).toContainText(
    /The request was rejected|요청이 거부되었습니다/,
  );
}

test.describe('QuantStudio Non-Usable File Rejection', () => {
  test('Raw Data file shows helpful error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(QS_DIR, 'ASG-PCR-NTCtest_Raw Data.xls')
    );

    await expectRejected(page);
  });

  test('Results file shows helpful error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(QS_DIR, 'ASG-PCR-NTCtest_Results.xls')
    );

    await expectRejected(page);
  });

  test('Sample Setup file shows helpful error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(QS_DIR, 'ASG-PCR-NTCtest_Sample Setup.xls')
    );

    await expectRejected(page);
  });
});

test.describe('CFX Opus Non-Usable File Rejection', () => {
  test('Quantification Cq Results shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Cq Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });

  test('Melt Curve file shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Melt Curve Plate View Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });

  test('ANOVA Results shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  ANOVA Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });

  test('Standard Curve Results shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Standard Curve Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });

  test('Gene Expression Results shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Gene Expression Results - Bar Chart.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });

  test('Quantification Summary shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Summary.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });

  test('Quantification Plate View shows error', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Plate View Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText(/Error|오류/, { timeout: 15000 });
  });
});
