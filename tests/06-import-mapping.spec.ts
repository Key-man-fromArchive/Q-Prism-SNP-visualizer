import { test, expect } from '@playwright/test';
import path from 'path';
import { login } from './helpers';

const GENERIC_LONG_WT_MT = path.resolve(
  'snp-analyzer/tests/fixtures/import/generic_long/wt_mt.csv'
);

test.describe('Mapped Import Workflow', () => {
  test('generic long CSV opens mapping wizard and imports', async ({ page }) => {
    await login(page);
    await page.locator('#file-input').setInputFiles(GENERIC_LONG_WT_MT);

    await expect(page.getByText('Import mapping')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Column mapping')).toBeVisible();
    await expect(page.getByText('Assay role binding')).toBeVisible();
    await expect(page.getByText('Validation preview')).toBeVisible();
    await expect(page.getByText('WT=FAM')).toBeVisible();
    await expect(page.getByText('MT1=VIC')).toBeVisible();

    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
    await expect(page.locator('#upload-status')).toContainText('Generic');
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
  });
});
