import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { uploadAndWait } from './helpers';

// Default (expert mode off) results screen: only what an operator needs to read
// the plate, with the technical controls behind the header's expert toggle.
const FIXTURE = path.join(__dirname, 'fixtures', 'stepone', 'stepone-partial-names.eds');

const EXPERT_ONLY = [
  'scatter-tool-edit', 'scatter-use-rox', 'axis-mode', 'analysis-advanced-settings',
  'plot-view-curve', 'multi-analyze-recommended', 'marker-observed-classes', 'marker-ntc-note',
];

test.describe('results layout and expert mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uploadAndWait(page, FIXTURE);
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('marker-scatter')).toBeVisible();
  });

  const expertToggle = (page: Page) => page.getByTestId('expert-mode-toggle');

  test('hides technical controls and the full grid by default', async ({ page }) => {
    await expect(expertToggle(page)).toHaveAttribute('aria-pressed', 'false');
    for (const id of EXPERT_ONLY) await expect(page.getByTestId(id), id).toHaveCount(0);
    await expect(page.getByTestId('results-scroll-region')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh QC' })).toHaveCount(0);
    // What stays: instrument, wells, marker choice, aspect/swap, plate and counts.
    await expect(page.locator('#instrument-badge')).toContainText(/StepOne/i);
    await expect(page.locator('#wells-badge')).toBeVisible();
    await expect(page.locator('#cycles-badge')).toHaveCount(0);
    await expect(page.getByTestId('scatter-aspect-select')).toBeVisible();
    await expect(page.getByTestId('scatter-swap-axes')).toBeVisible();
    await expect(page.getByTestId('genotype-counts')).toBeVisible();
  });

  test('keeps the legend inside the scatter and puts the counts right under the plate', async ({ page }) => {
    const legend = await page.getByTestId('marker-scatter').evaluate(node => {
      const layout = (node as HTMLElement & { layout?: { legend?: { x: number; y: number; xanchor: string }; margin?: { b: number } } }).layout;
      return { legend: layout?.legend, bottom: layout?.margin?.b };
    });
    expect(legend.legend?.xanchor).toBe('right');
    expect(legend.legend?.x).toBeGreaterThan(0.5);
    expect(legend.legend?.y).toBeGreaterThan(0.5);
    expect(legend.bottom).toBeLessThan(80);

    const plate = await page.locator('#plate-grid').boundingBox();
    const counts = await page.getByTestId('genotype-counts-card').boundingBox();
    expect(plate && counts && counts.y >= plate.y + plate.height - 1).toBeTruthy();
  });

  test('expert mode brings the technical controls back and survives a reload', async ({ page }) => {
    await expertToggle(page).click();
    await expect(expertToggle(page)).toHaveAttribute('aria-pressed', 'true');
    for (const id of ['scatter-tool-edit', 'scatter-use-rox', 'axis-mode', 'analysis-advanced-settings',
      'plot-view-curve', 'multi-analyze-recommended', 'marker-observed-classes']) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    await expect(page.getByTestId('results-scroll-region')).toBeVisible();
    await page.reload();
    await expect(expertToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expertToggle(page).click();
    await expect(page.getByTestId('results-scroll-region')).toHaveCount(0);
  });
});
