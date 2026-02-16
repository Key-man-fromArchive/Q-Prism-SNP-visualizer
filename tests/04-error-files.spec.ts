import { test, expect } from '@playwright/test';
import path from 'path';

const QS_DIR = '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/Quantstudio3';
const CFX_DIR = '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/CFX-opus';

test.describe('QuantStudio Non-Usable File Rejection', () => {
  test('Raw Data file shows helpful error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(QS_DIR, 'ASG-PCR-NTCtest_Raw Data.xls')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
    await expect(status).toContainText('Multicomponent Data');
  });

  test('Results file shows helpful error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(QS_DIR, 'ASG-PCR-NTCtest_Results.xls')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
    await expect(status).toContainText('Multicomponent Data');
  });

  test('Sample Setup file shows helpful error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(QS_DIR, 'ASG-PCR-NTCtest_Sample Setup.xls')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
    await expect(status).toContainText('Multicomponent Data');
  });
});

test.describe('CFX Opus Non-Usable File Rejection', () => {
  test('Quantification Cq Results shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Cq Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });

  test('Melt Curve file shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Melt Curve Plate View Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });

  test('ANOVA Results shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  ANOVA Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });

  test('Standard Curve Results shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Standard Curve Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });

  test('Gene Expression Results shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Gene Expression Results - Bar Chart.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });

  test('Quantification Summary shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Summary.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });

  test('Quantification Plate View shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(
      path.resolve(CFX_DIR, 'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Plate View Results.xlsx')
    );

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Error', { timeout: 15000 });
  });
});
