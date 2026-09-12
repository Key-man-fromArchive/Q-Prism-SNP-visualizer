import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Homepage & Initial State', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Q-prism® Cluster Caller');
  });

  test('local login page is visible before authentication', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign In|로그인/ })).toBeVisible();
  });

  test('upload zone is visible on load', async ({ page }) => {
    await login(page);
    const dropArea = page.locator('#drop-area');
    await expect(dropArea).toBeVisible();
    await expect(dropArea).toContainText(
      /Drag & drop your raw fluorescence file here|형광 데이터 파일을 여기에 드래그 & 드롭하세요/,
    );
  });

  test('browse button exists and is clickable', async ({ page }) => {
    await login(page);
    const browseBtn = page.locator('#browse-btn');
    await expect(browseBtn).toBeVisible();
    await expect(browseBtn).toHaveText(/Browse Files|파일 찾아보기/);
  });

  test('file input accepts raw, RDML, and mapped import files', async ({ page }) => {
    await login(page);
    const fileInput = page.locator('#file-input');
    await expect(fileInput).toHaveAttribute(
      'accept',
      '.eds,.xls,.xlsx,.pcrd,.zip,.xml,.csv,.tsv,.txt,.rdml,.rdm',
    );
  });

  test('the running version is stated before and after login', async ({ page }) => {
    // An operator has to be able to quote a version in a bug report, which
    // means seeing it on the login screen too — not only once they are in.
    await page.goto('/');
    const version = page.getByTestId('app-version');
    await expect(version).toBeVisible();
    await expect(version).toHaveText(/Q-prism® v\d+\.\d+\.\d+/);

    await login(page);
    await expect(page.getByTestId('app-version')).toBeVisible();
  });

  test('analysis panel is hidden initially', async ({ page }) => {
    await login(page);
    const analysisPanel = page.locator('#analysis-panel');
    await expect(analysisPanel).toHaveClass(/hidden/);
  });

  test('session info badges are hidden initially', async ({ page }) => {
    await login(page);
    await expect(page.locator('#session-info')).toHaveCount(0);
  });

  test('Plotly.js CDN script is loaded', async ({ page }) => {
    await login(page);
    const plotly = await page.evaluate(() => typeof (window as any).Plotly);
    expect(plotly).toBe('object');
  });

  test('CSS and layout render properly', async ({ page }) => {
    await login(page);
    const header = page.locator('header h1');
    await expect(header).toHaveText(/Q-prism® Cluster Caller/);
    await expect(header).toBeVisible();
  });

  test('import template downloads are exposed', async ({ page }) => {
    await login(page);
    await expect(page.getByText(/Import templates|가져오기 양식/)).toBeVisible();
    await expect(page.getByRole('link', { name: /RDES (amplification TSV|증폭 TSV)/ })).toHaveAttribute(
      'href',
      '/templates/qprism-rdes-amplification-template.tsv'
    );
    await expect(page.getByRole('link', { name: /Generic long CSV|일반 long CSV/ })).toHaveAttribute(
      'href',
      '/templates/qprism-generic-long-template.csv'
    );
    await expect(page.getByRole('link', { name: /Generic wide CSV|일반 wide CSV/ })).toHaveAttribute(
      'href',
      '/templates/qprism-generic-wide-template.csv'
    );
  });
});
