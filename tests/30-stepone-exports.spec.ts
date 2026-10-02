import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { uploadAndWait } from './helpers';
import { EXPORT_TEST_IDS as ID } from '../snp-analyzer/frontend/src/lib/export-testids';

// StepOnePlus exports through the export dialog: PDF, PPTX and the report PNG
// zip, each limited to two of the six markers. Selectors come from
// export-testids.ts so the dialog and this spec cannot drift apart.
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8402' });

const FIXTURE = path.join(__dirname, 'fixtures', 'stepone', 'stepone-user-names.eds');
const PICKED = 2;

/** Entry names of a zip, read from the central directory (no dependency needed). */
function zipEntries(buf: Buffer): string[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    names.push(buf.toString('utf8', pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

async function openExportDialog(page: Page) {
  await page.getByRole('button', { name: /^Export$/ }).click();
  const dialog = page.getByTestId(ID.dialog);
  if (!(await dialog.isVisible())) {
    // The header menu lists formats first; the dialog opens from its entries.
    await page.getByRole('menuitem').filter({ hasText: /PowerPoint|report/i }).first().click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pickTwoMarkers(page: Page) {
  const options = page.getByTestId(ID.markerOption);
  await expect(options).toHaveCount(6);
  const selectAll = page.getByTestId(ID.markerSelectAll);
  if (await selectAll.isChecked()) await selectAll.click();
  for (let i = 0; i < PICKED; i++) await options.nth(i).getByRole('checkbox').check();
}

async function exportAs(page: Page, format: string): Promise<Buffer> {
  await openExportDialog(page);
  await pickTwoMarkers(page);
  await page.getByTestId(format).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(ID.submit).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();
  return fs.readFileSync(file!);
}

test.describe('StepOnePlus exports', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await uploadAndWait(page, FIXTURE);
  });

  test('PDF export downloads a PDF document', async ({ page }) => {
    const pdf = await exportAs(page, ID.formatPdf);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  });

  test('PPTX export has a title, one slide per picked marker and a results slide', async ({ page }) => {
    const pptx = await exportAs(page, ID.formatPptx);
    const slides = zipEntries(pptx).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    // Title + one per marker + plate overview + at least one results table slide.
    expect(slides.length).toBeGreaterThanOrEqual(1 + PICKED + 1 + 1);
    expect(slides.length).toBeLessThanOrEqual(1 + PICKED + 1 + 2);
  });

  test('report PNG zip has exactly one image per picked marker', async ({ page }) => {
    const zip = await exportAs(page, ID.formatPngZip);
    const names = zipEntries(zip);
    expect(names).toHaveLength(PICKED);
    for (const name of names) {
      expect(name).toMatch(/\.png$/i);
      expect(name).not.toMatch(/[\\/]|\.\./);
    }
    expect(new Set(names).size).toBe(PICKED);
  });
});
