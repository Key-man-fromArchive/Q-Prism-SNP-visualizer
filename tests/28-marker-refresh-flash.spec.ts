import { test, expect } from '@playwright/test';
import { login } from './helpers';

// P17-MARKER-FLASH: a markers-changed refetch used to unmount the entire
// Results panel with no loading state for the duration of the refetch (see
// docs/planning/feedback-2026-09-11/evidence/P17-MARKER-FLASH.md). The panel
// now stays mounted with the last-known-good content, with a small
// non-blocking badge overlaid on top instead.
test.describe('P17: results panel survives a marker refetch', () => {
  test('keeps the results panel visible with a busy badge during a slow marker refetch, then switches views', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await login(page);
    await page.locator('#example-select').selectOption('2');
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/);
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('single-marker-analysis-view')).toBeVisible();
    const sid = new URL(page.url()).searchParams.get('session');
    expect(sid).toBeTruthy();

    // Simulate a slow connection: hold the GET markers response for 600ms.
    await page.route(/\/api\/data\/[^/]+\/markers(\?|$)/, async route => {
      if (route.request().method() === 'GET') await new Promise(r => setTimeout(r, 600));
      await route.continue();
    });
    const created = await page.evaluate(async sid => {
      const res = await fetch(`/api/data/${sid}/markers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markers: [{ id: 'm1', name: 'Marker 1', wells: ['A1'], ploidy: 2 }] }),
      });
      return res.ok;
    }, sid);
    expect(created).toBe(true);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('markers-changed')));

    // No blank gap: the previous (still-correct, momentarily stale) panel
    // stays up the whole time, with a small aria-busy badge overlaid on top.
    await expect(page.getByTestId('single-marker-analysis-view')).toBeVisible();
    await expect(page.getByTestId('marker-refresh-indicator')).toBeVisible();
    await expect(page.getByTestId('single-marker-analysis-view')).toBeVisible();

    // Once the refetch resolves, the panel switches to the per-marker view
    // and the badge clears.
    await expect(page.getByTestId('marker-selector-sidebar').or(page.getByTestId('marker-selector-dropdown'))).toBeVisible();
    await expect(page.getByTestId('marker-refresh-indicator')).toBeHidden();
  });

  test('keeps the results panel visible with an inline error when a marker refetch fails, instead of going blank', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await login(page);
    await page.locator('#example-select').selectOption('2');
    await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/);
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('single-marker-analysis-view')).toBeVisible();

    await page.route(/\/api\/data\/[^/]+\/markers(\?|$)/, async route => {
      if (route.request().method() === 'GET') return route.fulfill({ status: 500, json: { detail: 'synthetic failure' } });
      await route.continue();
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('markers-changed')));

    await expect(page.getByTestId('single-marker-analysis-view')).toBeVisible();
    await expect(page.getByTestId('marker-refresh-error')).toBeVisible();
    // Stays up afterward too -- not a transient flash that then goes blank.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('single-marker-analysis-view')).toBeVisible();
  });
});
