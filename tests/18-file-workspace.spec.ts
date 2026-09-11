import { test, expect } from '@playwright/test';
import { login } from './helpers';

type SessionSummary = {
  session_id: string;
  raw_filename: string;
  instrument: string;
  num_wells: number;
  num_cycles: number;
  uploaded_at: string;
};

test('drawer uploads files without activation and opens one on demand', async ({ page }) => {
  await login(page);

  const sessions: SessionSummary[] = [];
  let uploadIndex = 0;
  await page.route('**/api/upload', async (route) => {
    uploadIndex += 1;
    const filename = uploadIndex === 1 ? 'alpha.pcrd' : 'beta.eds';
    const sessionId = `drawer-${uploadIndex}`;
    sessions.unshift({
      session_id: sessionId,
      raw_filename: filename,
      instrument: 'CFX Opus',
      num_wells: 96,
      num_cycles: 40,
      uploaded_at: `2026-09-11T00:00:0${uploadIndex}Z`,
    });
    await route.fulfill({
      json: {
        session_id: sessionId,
        raw_filename: filename,
        instrument: 'CFX Opus',
        allele2_dye: 'HEX',
        num_wells: 96,
        num_cycles: 40,
        has_rox: false,
        data_windows: null,
        suggested_cycle: 40,
        background_modes: ['none'],
        well_groups: null,
      },
    });
  });
  await page.route('**/api/sessions**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const sessionId = pathname.split('/').at(-1);
    if (pathname === '/api/sessions') {
      await route.fulfill({ json: sessions });
      return;
    }
    const summary = sessions.find((item) => item.session_id === sessionId)!;
    await route.fulfill({
      json: {
        ...summary,
        allele2_dye: 'HEX',
        has_rox: false,
        data_windows: null,
        suggested_cycle: 40,
        background_modes: ['none'],
        well_groups: null,
      },
    });
  });

  await page.locator('#file-workspace-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').locator('input[type="file"]').first().setInputFiles([
    { name: 'alpha.pcrd', mimeType: 'application/octet-stream', buffer: Buffer.from('alpha') },
    { name: 'beta.eds', mimeType: 'application/octet-stream', buffer: Buffer.from('beta') },
  ]);

  await expect(page.locator('#file-workspace-button')).toContainText('2');
  await expect(page.locator('#session-info')).toHaveCount(0);

  await page.getByRole('button', { name: /alpha\.pcrd/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#session-info')).toContainText('CFX Opus');
});
