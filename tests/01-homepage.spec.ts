import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Homepage & Initial State', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('ASG-PCR SNP Discrimination Analyzer');
  });

  test('local login page is visible before authentication', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('upload zone is visible on load', async ({ page }) => {
    await login(page);
    const dropArea = page.locator('#drop-area');
    await expect(dropArea).toBeVisible();
    await expect(dropArea).toContainText('Drag & drop your raw fluorescence file here');
  });

  test('browse button exists and is clickable', async ({ page }) => {
    await login(page);
    const browseBtn = page.locator('#browse-btn');
    await expect(browseBtn).toBeVisible();
    await expect(browseBtn).toHaveText('Browse Files');
  });

  test('file input accepts raw, RDML, and mapped import files', async ({ page }) => {
    await login(page);
    const fileInput = page.locator('#file-input');
    await expect(fileInput).toHaveAttribute('accept', '.eds,.xls,.xlsx,.pcrd,.zip,.xml,.csv,.tsv,.txt');
  });

  test('analysis panel is hidden initially', async ({ page }) => {
    await login(page);
    const analysisPanel = page.locator('#analysis-panel');
    await expect(analysisPanel).toHaveClass(/hidden/);
  });

  test('session info badges are hidden initially', async ({ page }) => {
    await login(page);
    const sessionInfo = page.locator('#session-info');
    await expect(sessionInfo).toHaveClass(/hidden/);
  });

  test('Plotly.js CDN script is loaded', async ({ page }) => {
    await login(page);
    const plotly = await page.evaluate(() => typeof (window as any).Plotly);
    expect(plotly).toBe('object');
  });

  test('CSS and layout render properly', async ({ page }) => {
    await login(page);
    const header = page.locator('header h1');
    await expect(header).toHaveText('ASG-PCR SNP Discrimination Analyzer');
    await expect(header).toBeVisible();
  });

  test('import template downloads are exposed', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Import templates')).toBeVisible();
    await expect(page.getByRole('link', { name: 'RDES amplification TSV' })).toHaveAttribute(
      'href',
      '/templates/qprism-rdes-amplification-template.tsv'
    );
    await expect(page.getByRole('link', { name: 'Generic long CSV' })).toHaveAttribute(
      'href',
      '/templates/qprism-generic-long-template.csv'
    );
    await expect(page.getByRole('link', { name: 'Generic wide CSV' })).toHaveAttribute(
      'href',
      '/templates/qprism-generic-wide-template.csv'
    );
  });
});
