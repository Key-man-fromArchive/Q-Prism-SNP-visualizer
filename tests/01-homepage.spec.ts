import { test, expect } from '@playwright/test';

test.describe('Homepage & Initial State', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('ASG-PCR SNP Discrimination Analyzer');
  });

  test('upload zone is visible on load', async ({ page }) => {
    await page.goto('/');
    const dropArea = page.locator('#drop-area');
    await expect(dropArea).toBeVisible();
    await expect(dropArea).toContainText('Drag & drop your raw fluorescence file here');
  });

  test('browse button exists and is clickable', async ({ page }) => {
    await page.goto('/');
    const browseBtn = page.locator('#browse-btn');
    await expect(browseBtn).toBeVisible();
    await expect(browseBtn).toHaveText('Browse Files');
  });

  test('file input accepts .eds, .xls, .xlsx, .pcrd, .zip, and .xml', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('#file-input');
    await expect(fileInput).toHaveAttribute('accept', '.eds,.xls,.xlsx,.pcrd,.zip,.xml');
  });

  test('analysis panel is hidden initially', async ({ page }) => {
    await page.goto('/');
    const analysisPanel = page.locator('#analysis-panel');
    await expect(analysisPanel).toHaveClass(/hidden/);
  });

  test('session info badges are hidden initially', async ({ page }) => {
    await page.goto('/');
    const sessionInfo = page.locator('#session-info');
    await expect(sessionInfo).toHaveClass(/hidden/);
  });

  test('Plotly.js CDN script is loaded', async ({ page }) => {
    await page.goto('/');
    const plotly = await page.evaluate(() => typeof (window as any).Plotly);
    expect(plotly).toBe('object');
  });

  test('CSS and layout render properly', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header h1');
    await expect(header).toHaveText('ASG-PCR SNP Discrimination Analyzer');
    await expect(header).toBeVisible();
  });
});
