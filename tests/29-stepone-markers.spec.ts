import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadAndWait } from './helpers';

// StepOnePlus .eds end to end: first screen lands on the first amplification
// read (PCR 36), the six plate markers are imported, per-marker allele names
// can be edited, and switching markers keeps the results table in step.
// Fixtures are synthetic (tests/fixtures/stepone/make_fixtures.py).
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8402' });

const FIXTURE = path.join(__dirname, 'fixtures', 'stepone', 'stepone-partial-names.eds');

test.describe('StepOnePlus markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await uploadAndWait(page, FIXTURE);
  });

  test('opens on the first amplification read with PCR cycle 36', async ({ page }) => {
    await expect(page.getByTestId('cycle-read-label')).toContainText('PCR 36');
    await expect(page.getByTestId('cycle-read-label')).toContainText('Amplification 1/5');
    await expect(page.locator('#instrument-badge')).toContainText(/StepOne/i);
  });

  test('imports six markers and shows file-declared allele names', async ({ page }) => {
    await page.locator('#tab-plate').click();
    const cards = page.getByTestId('marker-card');
    await expect(cards).toHaveCount(6);
    await expect(cards.first()).toContainText('QPrism1');
    // Only QPrism1 declares its own names (MT/WT); the rest use the defaults.
    await expect(cards.first().getByTestId('marker-card-alleles')).toContainText('MT');
    await expect(cards.first().getByTestId('marker-card-alleles')).toContainText('WT');
    await expect(cards.nth(1).getByTestId('marker-card-alleles')).toHaveCount(0);
  });

  test('edits allele names, switches markers and reads the results table', async ({ page }) => {
    await page.locator('#tab-plate').click();
    const cards = page.getByTestId('marker-card');
    await expect(cards).toHaveCount(6);

    await cards.nth(1).getByRole('button', { name: /edit/i }).click();
    await expect(page.getByTestId('marker-form')).toBeVisible();
    await page.getByTestId('marker-allele-fam-input').fill('REFX');
    await page.getByTestId('marker-allele-allele2-input').fill('MUTX');
    await page.getByTestId('marker-form-save').click();
    await expect(page.getByTestId('marker-form')).toBeHidden();
    await expect(cards.nth(1).getByTestId('marker-card-alleles')).toContainText('REFX');
    await expect(cards.nth(1).getByTestId('marker-card-alleles')).toContainText('MUTX');

    // The edit is persisted server-side, not just in local state.
    const sid = new URL(page.url()).searchParams.get('session');
    expect(sid).toBeTruthy();
    const saved = await page.evaluate(async id => {
      const res = await fetch(`/api/data/${id}/markers`);
      return res.json();
    }, sid);
    const markers = Array.isArray(saved) ? saved : saved.markers;
    expect(markers.find((m: { name: string }) => m.name === 'QPrism2').allele_labels)
      .toEqual({ fam: 'REFX', allele2: 'MUTX' });

    await page.locator('#tab-results').click();
    const selector = page.getByTestId('marker-selector-sidebar').or(page.getByTestId('marker-selector-dropdown'));
    await expect(selector).toBeVisible();

    const pickMarker = async (index: number, name: string) => {
      const sidebar = page.getByTestId('marker-sidebar-card');
      if (await sidebar.count()) {
        await expect(sidebar).toHaveCount(6);
        await sidebar.nth(index).click();
      } else {
        await page.getByTestId('marker-selector-dropdown').selectOption({ label: name });
      }
    };
    const region = page.getByTestId('results-scroll-region');
    const named = (name: string) => region.locator(`[role="gridcell"][aria-label*="${name}"]`);

    // QPrism2: the edited names appear in the call descriptions of the results grid.
    await pickMarker(1, 'QPrism2');
    await expect(named('REFX').first()).toBeAttached();
    await expect(named('MUTX').first()).toBeAttached();
    await expect(named('WT')).toHaveCount(0);

    // QPrism1: back to the names declared in the file; nothing leaks over.
    await pickMarker(0, 'QPrism1');
    await expect(named('WT').first()).toBeAttached();
    await expect(named('MT').first()).toBeAttached();
    await expect(named('REFX')).toHaveCount(0);
  });
});
