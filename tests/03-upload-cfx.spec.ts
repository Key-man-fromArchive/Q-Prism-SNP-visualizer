import { test, expect } from '@playwright/test';
import path from 'path';

const CFX_DIR = '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/CFX-opus';

const CFX_AMPLIFICATION = path.resolve(
  CFX_DIR,
  'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results.xlsx'
);
const CFX_ENDPOINT = path.resolve(
  CFX_DIR,
  'admin_2026-02-16 11-12-20_783BR20183 -  End Point Results.xlsx'
);
const CFX_ALLELIC = path.resolve(
  CFX_DIR,
  'admin_2026-02-16 11-12-20_783BR20183 -  Allelic Discrimination Results.xlsx'
);

test.describe('CFX Opus Amplification Results Upload', () => {
  test('upload succeeds and shows CFX Opus badge', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(CFX_AMPLIFICATION);

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Parsed', { timeout: 15000 });
    await expect(status).toContainText('CFX Opus');
  });

  test('single-cycle data hides cycle slider', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(CFX_AMPLIFICATION);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });

    // Cycle slider should be hidden for single-cycle data
    const cycleControl = page.locator('#cycle-control');
    await expect(cycleControl).toHaveClass(/hidden/);
  });

  test('96 wells render in plate view', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(CFX_AMPLIFICATION);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.waitForTimeout(2000);

    await expect(page.locator('#wells-badge')).toContainText('96 wells');

    const coloredWells = await page.locator('.plate-well:not(.empty)').count();
    expect(coloredWells).toBe(96);
  });

  test('scatter plot renders with data', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(CFX_AMPLIFICATION);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.waitForTimeout(2000);

    const hasPlot = await page.evaluate(() => {
      const el = document.getElementById('scatter-plot');
      return el && (el.querySelector('canvas') !== null || el.querySelector('.plot-container') !== null);
    });
    expect(hasPlot).toBe(true);
  });
});

test.describe('CFX Opus End Point Results Upload', () => {
  test('endpoint data parses and renders', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(CFX_ENDPOINT);

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Parsed', { timeout: 15000 });
    await expect(status).toContainText('CFX Opus');
    await expect(status).toContainText('96 wells');
  });
});

test.describe('CFX Opus Allelic Discrimination Results Upload', () => {
  test('allelic discrimination data parses and renders', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(CFX_ALLELIC);

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Parsed', { timeout: 15000 });
    await expect(status).toContainText('CFX Opus');
    await expect(status).toContainText('96 wells');
  });
});
