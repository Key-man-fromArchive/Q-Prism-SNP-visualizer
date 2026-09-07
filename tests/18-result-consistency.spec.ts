import { expect, test, type Download } from '@playwright/test';
import { login } from './helpers';

async function text(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function record(csv: string, well: string): Record<string, string> {
  const [header, ...rows] = csv.trim().split('\n').map(line => line.split(','));
  const values = rows.find(row => row[0] === well);
  expect(values, `whole-run row for ${well}`).toBeTruthy();
  return Object.fromEntries(header.map((name, index) => [name, values![index]]));
}

test('whole-run CSV export binds the visible result revision and explicit cycle mode', async ({ page }) => {
  await login(page);
  const clustered = page.waitForResponse(response => response.url().includes('/api/data/')
    && response.url().endsWith('/cluster') && response.request().method() === 'POST');
  await page.locator('#example-select').selectOption('2');
  await clustered;
  await expect(page.locator('#scatter-plot')).toBeVisible();

  const request = page.waitForRequest(value => value.url().includes('/export/csv'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export|내보내기/ }).click();
  await page.getByRole('menuitem', { name: /CSV/ }).click();
  const [exportRequest, exported] = await Promise.all([request, download]);
  const query = new URL(exportRequest.url()).searchParams;
  expect(query.get('result_revision')).toMatch(/^[0-9a-f-]{36}$/i);
  expect(query.get('cycle_mode')).toBe('absolute');
  expect(query.get('cycle')).toBe('40');
  expect(await exported.suggestedFilename()).toMatch(/\.csv$/);
  const csv = await text(exported);
  const rows = csv.trim().split('\n');
  expect(rows).toHaveLength(97); // header + complete 96-well synthetic plate
  expect(csv).toContain('Result Revision');
  expect(csv).toContain(query.get('result_revision')!);
  expect(csv).toContain('whole-run');
  const a1 = record(csv, 'A1');
  // Example 2x is deterministic. These paired coordinates prove this is the
  // accepted endpoint row, rather than merely a 96-line CSV shell.
  expect(a1['FAM (norm)']).toBe('1.263527');
  expect(a1['FAM (raw)']).toBe('1.2635');
  expect(a1['HEX (norm)']).toBe('0.023803');
  expect(a1['Result Revision']).toBe(query.get('result_revision'));
  expect(a1.Scope).toBe('whole-run');

  // Selection, a persisted manual group and the selected-only scatter filter
  // are all view state: none may narrow an accepted whole-run report.
  // Use PlateView's keyboard selection contract. Its panel owns pointer
  // capture for drag selection, whereas Enter on the roving A1 grid cell
  // deterministically toggles the same selected-wells state without relying
  // on a synthetic click's retargeting behavior.
  const a1Cell = page.locator('#plate-grid').getByRole('gridcell', { name: /^A1, d2\/2/ });
  await a1Cell.focus();
  await page.keyboard.press('Enter');
  await expect(a1Cell).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('analysis-selection-toolbar')).toBeVisible();
  await expect(page.getByTestId('analysis-selection-count')).not.toContainText('0');
  const grouped = page.waitForResponse(response => response.url().endsWith('/groups')
    && response.request().method() === 'POST');
  await page.getByTestId('manual-group-1').click();
  await grouped;
  await page.getByTestId('scatter-selected-only').click();
  await expect(page.getByTestId('scatter-selected-only')).toHaveAttribute('aria-pressed', 'true');
  const repeatRequest = page.waitForRequest(value => value.url().includes('/export/csv'));
  const repeatDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export|내보내기/ }).click();
  await page.getByRole('menuitem', { name: /CSV/ }).click();
  await repeatRequest;
  expect(await text(await repeatDownload)).toBe(csv);
});
