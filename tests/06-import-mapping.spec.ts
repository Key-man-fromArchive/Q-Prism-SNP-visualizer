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

    // Guided 4-step wizard: step 1 (structure) is shown first.
    // The app defaults to Korean (since 79f60ac); match either language the
    // way 01-homepage/02-upload-quantstudio already do.
    await expect(page.getByText(/Import mapping|가져오기 매핑/)).toBeVisible({ timeout: 15000 });

    // Step 2 — column mapping
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText(/Column mapping|열 매핑/)).toBeVisible();

    // Step 3 — assay role binding
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText(/Assay role binding|분석 역할 지정/)).toBeVisible();

    // Step 4 — review: validation summary + role bindings. Role labels (WT,
    // MT1) are literal assay roles, not translated strings.
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText(/Validation preview|검증 미리보기/)).toBeVisible();
    await expect(page.getByText('WT=FAM')).toBeVisible();
    await expect(page.getByText('MT1=VIC')).toBeVisible();

    await page.getByTestId('wizard-import').click();

    // A parsed upload hands straight over to the workspace, unmounting
    // UploadZone (and #upload-status) immediately — so the run identity is
    // read off the header badge, the same way 02-upload-quantstudio does.
    await expect(page.locator('#instrument-badge')).toContainText('Generic', { timeout: 15000 });
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
  });
});
