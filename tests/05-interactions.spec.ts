import { test, expect } from '@playwright/test';
import path from 'path';

const QS_MULTICOMPONENT = path.resolve(
  '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/Quantstudio3/ASG-PCR-NTCtest_Multicomponent Data.xls'
);
const CFX_AMPLIFICATION = path.resolve(
  '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/CFX-opus',
  'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results.xlsx'
);

async function uploadAndWait(page, filePath: string) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(filePath);
  await expect(page.locator('#upload-status')).toContainText('Parsed', { timeout: 15000 });
  await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/, { timeout: 5000 });
  await page.waitForTimeout(2000);
}

test.describe('Plate View Interaction', () => {
  test('clicking a plate well updates detail panel', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    // Find a colored well and click it
    const well = page.locator('.plate-well:not(.empty)').first();
    await well.click();

    // Detail panel should update
    const detailContent = page.locator('#detail-content');
    await expect(detailContent).not.toContainText('Click a well to see details', { timeout: 3000 });
    // Should have a detail table with values
    await expect(detailContent.locator('.detail-table')).toBeVisible();
  });

  test('clicking well shows well ID in detail panel', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    // Click well A1
    const wellA1 = page.locator('.plate-well[data-well="A1"]');
    await wellA1.click();

    const detailContent = page.locator('#detail-content');
    await expect(detailContent).toContainText('A1', { timeout: 3000 });
  });

  test('clicked well gets selected class', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    const wellA1 = page.locator('.plate-well[data-well="A1"]');
    await wellA1.click();

    await expect(wellA1).toHaveClass(/selected/);
  });

  test('clicking another well deselects previous', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    const wellA1 = page.locator('.plate-well[data-well="A1"]');
    const wellA2 = page.locator('.plate-well[data-well="A2"]');

    await wellA1.click();
    await expect(wellA1).toHaveClass(/selected/);

    await wellA2.click();
    await expect(wellA2).toHaveClass(/selected/);
    await expect(wellA1).not.toHaveClass(/selected/);
  });
});

test.describe('Detail Panel Content', () => {
  test('detail table shows FAM and HEX values', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    const wellA1 = page.locator('.plate-well[data-well="A1"]');
    await wellA1.click();

    const detail = page.locator('#detail-content');
    // Label depends on ROX state: "FAM/ROX" when ROX ON, "FAM" when OFF
    // CFX defaults to ROX OFF, so label is just "FAM"
    await expect(detail).toContainText(/FAM(\/ROX)?/);
    await expect(detail).toContainText(/HEX(\/ROX)?/);
    await expect(detail).toContainText('Genotype');
    await expect(detail).toContainText('FAM ratio');
  });
});

test.describe('Tab Switching', () => {
  test('protocol tab switches correctly', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    // Click Protocol tab
    const protocolTab = page.locator('.tab[data-tab="protocol"]');
    await protocolTab.click();

    // Protocol content should be visible
    await expect(page.locator('#tab-protocol')).toHaveClass(/active/);
    await expect(page.locator('#tab-analysis')).not.toHaveClass(/active/);

    // Protocol table should be visible
    await expect(page.locator('#protocol-table')).toBeVisible();
  });

  test('switching back to analysis tab works', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    // Go to protocol
    await page.locator('.tab[data-tab="protocol"]').click();
    await expect(page.locator('#tab-protocol')).toHaveClass(/active/);

    // Go back to analysis
    await page.locator('.tab[data-tab="analysis"]').click();
    await expect(page.locator('#tab-analysis')).toHaveClass(/active/);
  });
});

test.describe('Protocol Tab', () => {
  test('default protocol steps are loaded', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    await page.locator('.tab[data-tab="protocol"]').click();
    await page.waitForTimeout(1000);

    // Should have protocol steps (default is 6 steps)
    const rows = page.locator('#protocol-table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('protocol plot renders', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    await page.locator('.tab[data-tab="protocol"]').click();
    await page.waitForTimeout(1000);

    const hasPlot = await page.evaluate(() => {
      const el = document.getElementById('protocol-plot');
      return el && el.querySelector('.plot-container') !== null;
    });
    expect(hasPlot).toBe(true);
  });

  test('add step button works', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    await page.locator('.tab[data-tab="protocol"]').click();
    await page.waitForTimeout(1000);

    const rowsBefore = await page.locator('#protocol-table tbody tr').count();
    await page.locator('#add-step-btn').click();
    const rowsAfter = await page.locator('#protocol-table tbody tr').count();

    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  test('delete step button works', async ({ page }) => {
    await uploadAndWait(page, CFX_AMPLIFICATION);

    await page.locator('.tab[data-tab="protocol"]').click();
    await page.waitForTimeout(1000);

    const rowsBefore = await page.locator('#protocol-table tbody tr').count();
    // Delete last row
    await page.locator('#protocol-table tbody tr .del-btn').last().click();
    const rowsAfter = await page.locator('#protocol-table tbody tr').count();

    expect(rowsAfter).toBe(rowsBefore - 1);
  });
});

test.describe('QuantStudio Multi-Cycle Features', () => {
  test('amplification curve appears when well clicked', async ({ page }) => {
    await uploadAndWait(page, QS_MULTICOMPONENT);

    // Click a colored well
    const well = page.locator('.plate-well:not(.empty)').first();
    await well.click();
    await page.waitForTimeout(1500);

    // Amplification plot should appear for multi-cycle data
    const ampPlot = page.locator('#amplification-plot');
    await expect(ampPlot).not.toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('play button exists and toggles', async ({ page }) => {
    await uploadAndWait(page, QS_MULTICOMPONENT);

    const playBtn = page.locator('#play-btn');
    await expect(playBtn).toBeVisible();

    // Initial state should be play icon
    const textBefore = await playBtn.textContent();

    // Click to play
    await playBtn.click();
    await page.waitForTimeout(100);

    // Click to pause
    await playBtn.click();
  });
});

test.describe('API Endpoints Direct', () => {
  test('upload API returns correct response', async ({ request }) => {
    const filePath = QS_MULTICOMPONENT;
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(filePath);

    const response = await request.post('/api/upload', {
      multipart: {
        file: {
          name: 'ASG-PCR-NTCtest_Multicomponent Data.xls',
          mimeType: 'application/vnd.ms-excel',
          buffer: fileBuffer,
        },
      },
    });

    expect(response.ok()).toBe(true);
    const json = await response.json();
    expect(json.session_id).toBeTruthy();
    expect(json.instrument).toBe('QuantStudio 3');
    expect(json.num_cycles).toBe(25);
    expect(json.num_wells).toBeGreaterThan(0);
    expect(json.has_rox).toBe(true);

    // Test scatter endpoint with session
    const scatterRes = await request.get(`/api/data/${json.session_id}/scatter?cycle=25`);
    expect(scatterRes.ok()).toBe(true);
    const scatterJson = await scatterRes.json();
    expect(scatterJson.points.length).toBeGreaterThan(0);
    expect(scatterJson.allele2_dye).toBe('VIC');
    expect(scatterJson.cycle).toBe(25);

    // Test plate endpoint
    const plateRes = await request.get(`/api/data/${json.session_id}/plate?cycle=25`);
    expect(plateRes.ok()).toBe(true);
    const plateJson = await plateRes.json();
    expect(plateJson.wells.length).toBeGreaterThan(0);

    // Test amplification endpoint
    const firstWell = scatterJson.points[0].well;
    const ampRes = await request.get(`/api/data/${json.session_id}/amplification?wells=${firstWell}`);
    expect(ampRes.ok()).toBe(true);
    const ampJson = await ampRes.json();
    expect(ampJson.curves.length).toBe(1);
    expect(ampJson.curves[0].cycles.length).toBe(25);

    // Test protocol endpoint
    const protoRes = await request.get(`/api/data/${json.session_id}/protocol`);
    expect(protoRes.ok()).toBe(true);
    const protoJson = await protoRes.json();
    expect(protoJson.steps.length).toBeGreaterThanOrEqual(1);
  });

  test('scatter data has valid normalized values', async ({ request }) => {
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(QS_MULTICOMPONENT);

    const response = await request.post('/api/upload', {
      multipart: {
        file: {
          name: 'ASG-PCR-NTCtest_Multicomponent Data.xls',
          mimeType: 'application/vnd.ms-excel',
          buffer: fileBuffer,
        },
      },
    });

    const json = await response.json();
    const scatterRes = await request.get(`/api/data/${json.session_id}/scatter?cycle=25`);
    const scatterJson = await scatterRes.json();

    for (const point of scatterJson.points) {
      expect(point.well).toMatch(/^[A-H]\d{1,2}$/);
      expect(typeof point.norm_fam).toBe('number');
      expect(typeof point.norm_allele2).toBe('number');
      expect(point.norm_fam).toBeGreaterThanOrEqual(0);
      expect(point.norm_allele2).toBeGreaterThanOrEqual(0);
      expect(typeof point.raw_fam).toBe('number');
      expect(typeof point.raw_allele2).toBe('number');
    }
  });

  test('invalid session returns 404', async ({ request }) => {
    const res = await request.get('/api/data/nonexistent/scatter?cycle=1');
    expect(res.status()).toBe(404);
  });

  test('invalid cycle returns 400', async ({ request }) => {
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(QS_MULTICOMPONENT);

    const response = await request.post('/api/upload', {
      multipart: {
        file: {
          name: 'ASG-PCR-NTCtest_Multicomponent Data.xls',
          mimeType: 'application/vnd.ms-excel',
          buffer: fileBuffer,
        },
      },
    });

    const json = await response.json();
    const res = await request.get(`/api/data/${json.session_id}/scatter?cycle=999`);
    expect(res.status()).toBe(400);
  });
});
