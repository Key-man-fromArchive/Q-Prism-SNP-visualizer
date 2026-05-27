import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME || 'admin';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'StrongerOperatorPassword123!';

export async function login(page: Page) {
  await page.goto('/');
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('header h1')).toHaveText('ASG-PCR SNP Discrimination Analyzer');
}

export async function loginRequest(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', {
    data: {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function uploadAndWait(page: Page, filePath: string) {
  await login(page);
  await page.locator('#file-input').setInputFiles(filePath);
  await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
  await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
  await page.waitForTimeout(1000);
}
