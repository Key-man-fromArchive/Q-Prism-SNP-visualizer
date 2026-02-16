import { test, expect } from '@playwright/test';
import path from 'path';

const QS_MULTICOMPONENT = path.resolve(
  '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/Quantstudio3/ASG-PCR-NTCtest_Multicomponent Data.xls'
);

const QS_AMPLIFICATION = path.resolve(
  '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/Quantstudio3/ASG-PCR-NTCtest_Amplification Data.xls'
);

test.describe('QuantStudio Multicomponent Data Upload', () => {
  test('upload via file input succeeds', async ({ page }) => {
    await page.goto('/');

    // Upload file
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(QS_MULTICOMPONENT);

    // Wait for success status
    const status = page.locator('#upload-status');
    await expect(status).toContainText('Parsed', { timeout: 15000 });
    await expect(status).toContainText('QuantStudio');
    await expect(status).toContainText('wells');
    await expect(status).toContainText('cycles');
  });

  test('analysis panel appears after upload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_MULTICOMPONENT);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });

    // Wait for analysis panel to become visible
    const analysisPanel = page.locator('#analysis-panel');
    await expect(analysisPanel).not.toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('session badges show correct info', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_MULTICOMPONENT);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });

    await expect(page.locator('#instrument-badge')).toContainText('QuantStudio');
    await expect(page.locator('#cycles-badge')).toContainText('25 cycles');
  });

  test('scatter plot renders with data points', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_MULTICOMPONENT);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });

    // Wait for Plotly scatter plot to render
    await page.waitForTimeout(2000);

    // Check scatter plot has content (Plotly creates canvas for scattergl)
    const hasPlot = await page.evaluate(() => {
      const el = document.getElementById('scatter-plot');
      return el && (el.querySelector('canvas') !== null || el.querySelector('.plot-container') !== null);
    });
    expect(hasPlot).toBe(true);
  });

  test('plate view renders with colored wells', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_MULTICOMPONENT);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });

    await page.waitForTimeout(2000);

    // Plate grid should have wells
    const plateGrid = page.locator('#plate-grid');
    await expect(plateGrid).toBeVisible();

    // Check that some wells are colored (not empty)
    const coloredWells = await page.locator('.plate-well:not(.empty)').count();
    expect(coloredWells).toBeGreaterThan(0);
  });

  test('cycle slider is visible with max=25', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_MULTICOMPONENT);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });

    const cycleControl = page.locator('#cycle-control');
    await expect(cycleControl).not.toHaveClass(/hidden/);

    const slider = page.locator('#cycle-slider');
    await expect(slider).toHaveAttribute('max', '25');

    // Cycle display should show 25 / 25
    await expect(page.locator('#cycle-max')).toHaveText('25');
  });

  test('cycle slider changes data when moved', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_MULTICOMPONENT);
    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.waitForTimeout(2000);

    // Move slider to cycle 1
    const slider = page.locator('#cycle-slider');
    await slider.fill('1');
    await slider.dispatchEvent('input');
    await expect(page.locator('#cycle-value')).toHaveText('1');

    // Wait for data to update
    await page.waitForTimeout(500);

    // Move slider to cycle 15
    await slider.fill('15');
    await slider.dispatchEvent('input');
    await expect(page.locator('#cycle-value')).toHaveText('15');
  });
});

test.describe('QuantStudio Amplification Data Upload', () => {
  test('amplification data file parses successfully', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(QS_AMPLIFICATION);

    const status = page.locator('#upload-status');
    await expect(status).toContainText('Parsed', { timeout: 15000 });
    await expect(status).toContainText('QuantStudio');
  });
});
