import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { uploadAndWait } from './helpers';

// Wells that never amplify: marker QPrism2 (columns 3-4) is flat in every read and
// well A1 of marker QPrism1 is flat too. The generator is
// tests/fixtures/stepone/make_fixtures.py; values are invented.
const FIXTURE = path.join(__dirname, 'fixtures', 'stepone', 'stepone-no-amplification.eds');
const SUMMARY = /Amplification threshold FAM ≥ \d+\.\d{2} · VIC ≥ \d+\.\d{2} \(auto, 1\/3 of the top 10%\)/;

type PlotNode = HTMLElement & { data?: { name?: string; customdata?: string[] }[] };

async function pickMarker(page: Page, name: string) {
  await page.getByTestId('marker-sidebar-card').filter({ hasText: name }).click();
}

const traceNames = (page: Page) =>
  page.getByTestId('marker-scatter').evaluate((node) => ((node as PlotNode).data ?? []).map((trace) => trace.name ?? ''));

test.describe('amplification check', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uploadAndWait(page, FIXTURE);
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('marker-scatter')).toBeVisible();
  });

  test('names the instrument from the file', async ({ page }) => {
    await expect(page.locator('#instrument-badge')).toContainText(/^Instrument: .*StepOne/i);
  });

  test('says a marker that never amplified did not amplify and keeps its wells out of the genotype classes', async ({ page }) => {
    await pickMarker(page, 'QPrism2');
    await expect(page.getByTestId('marker-no-amplification')).toHaveText('This marker did not amplify.');
    await expect(page.getByTestId('genotype-count-no-amplification')).toContainText('16');
    await expect.poll(() => traceNames(page)).toContain('No amplification (n=16)');
    await expect(page.locator('#plate-legend, [data-testid="plate-legend"]').first()).toContainText('No amplification');
  });

  test('flags a single flat well without calling the whole marker unamplified', async ({ page }) => {
    await pickMarker(page, 'QPrism1');
    await expect(page.getByTestId('marker-no-amplification')).toHaveCount(0);
    await expect(page.getByTestId('genotype-count-no-amplification')).toContainText('1');
    await expect.poll(() => traceNames(page)).toContain('No amplification (n=1)');
  });

  test('states the applied thresholds with the real channel names and no controls by default', async ({ page }) => {
    await expect(page.getByTestId('amplification-qc-summary')).toHaveText(SUMMARY);
    await expect(page.getByTestId('amplification-qc-controls')).toHaveCount(0);
  });

  test('expert mode: a manual threshold, then switching the check off, re-analyse with the new choice', async ({ page }) => {
    await page.getByTestId('expert-mode-toggle').click();
    await expect(page.getByTestId('amplification-qc-controls')).toBeVisible();

    // A threshold no well can reach flags every well, and the summary says it was typed in.
    await page.getByTestId('qc-fam-threshold').fill('1000000');
    await expect(page.getByTestId('amplification-qc-summary')).toContainText('(manual)');
    await pickMarker(page, 'QPrism3');
    await expect(page.getByTestId('marker-no-amplification')).toBeVisible();

    // Blank means automatic again.
    await page.getByTestId('qc-fam-threshold').fill('');
    await expect(page.getByTestId('amplification-qc-summary')).toHaveText(SUMMARY);
    await expect(page.getByTestId('marker-no-amplification')).toHaveCount(0);

    // Off: no flagged wells and no threshold line, only the note that the check is off.
    await page.getByTestId('qc-enabled').uncheck();
    await expect(page.getByTestId('amplification-qc-summary')).toHaveText('Amplification check off');
    await expect(page.getByTestId('genotype-count-no-amplification')).toHaveCount(0);

    // The choice is kept for the session, so it survives a reload.
    await page.reload();
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('qc-enabled')).not.toBeChecked();
  });
});
