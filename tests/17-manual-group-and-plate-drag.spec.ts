import { expect, test } from '@playwright/test';
import path from 'path';
import { login, uploadAndWait } from './helpers';

const CFX_AMPLIFICATION = path.resolve(
  '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/CFX-opus',
  'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results.xlsx'
);

test('dragging from plate whitespace selects visible wells and assigns Group 1', async ({ page }) => {
  await page.goto('/');
  const english = page.getByRole('button', { name: 'English' });
  if (await english.isVisible()) await english.click();
  await uploadAndWait(page, CFX_AMPLIFICATION);

  const panel = page.locator('.plate-panel');
  const grid = page.locator('#plate-grid');
  // Let the initial analysis land before measuring anything: it can add an
  // analysis-warning callout above the grid, and every coordinate below is
  // read from getBoundingClientRect, so a later reflow invalidates them.
  await expect(grid).toBeVisible();
  await page.waitForTimeout(1200);
  await grid.scrollIntoViewIfNeeded();
  const panelBox = await panel.boundingBox();
  const a1Box = await page.locator('.plate-well[data-well="A1"]').boundingBox();
  const b3Box = await page.locator('.plate-well[data-well="B3"]').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(a1Box).not.toBeNull();
  expect(b3Box).not.toBeNull();

  // Begin in the panel's white margin, deliberately outside #plate-grid.
  const gridBox = await grid.boundingBox();
  expect(gridBox).not.toBeNull();
  const startX = Math.max(panelBox!.x + 3, gridBox!.x - 18);
  expect(startX).toBeLessThan(gridBox!.x);
  await page.mouse.move(startX, a1Box!.y + a1Box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    b3Box!.x + b3Box!.width / 2,
    b3Box!.y + b3Box!.height / 2,
    { steps: 8 }
  );
  await page.mouse.up();

  const selected = page.locator('.plate-well[aria-pressed="true"]');
  expect(await selected.count()).toBeGreaterThan(1);
  await expect(selected.first()).toHaveClass(/ring-amber-400/);
  await expect(selected.first().locator('span')).toHaveText('✓');

  const groupOne = page.getByTestId('manual-group-1');
  const savedGroup = page.waitForResponse(
    (response) => response.url().endsWith('/groups') && response.request().method() === 'POST'
  );
  await groupOne.click();
  const savedPayload = await (await savedGroup).json();
  await expect(groupOne).toHaveAttribute('aria-pressed', 'true');
  await expect(groupOne).toContainText(/Group 1|그룹 1/);
  expect(savedPayload.name).toBe('Group 1');
  expect(savedPayload.wells.length).toBeGreaterThan(1);

  // Moving the NTC corner is now an explicit mode. A drag used to mean BOTH
  // "select wells" and "move the nearest threshold" at once, and the threshold
  // handler won -- it swallowed any mousedown within 18px of this corner
  // marker before Plotly saw it, and that marker sits inside the data cloud on
  // a raw endpoint plate. Selecting had to be the default; editing asks.
  const scatter = page.locator('#scatter-plot');
  await page.getByTestId('scatter-tool-edit').click();
  // The corner's screen position is read from getBoundingClientRect below, so
  // the plot has to actually be in the viewport -- the axis/threshold controls
  // above it push it past the fold on a 720px-tall window.
  await scatter.scrollIntoViewIfNeeded();
  // Switching the drag tool re-renders the plot, and the corner is inferred
  // from the current calls -- so let both settle before reading a position we
  // are about to press the mouse down on.
  await page.waitForTimeout(800);
  const ntcCorner = await scatter.evaluate((node) => {
    const gd = node as HTMLDivElement & {
      data?: Array<{ name?: string; x?: number[]; y?: number[] }>;
      _fullLayout?: {
        xaxis?: { _offset: number; _length: number; range: [number, number] };
        yaxis?: { _offset: number; _length: number; range: [number, number] };
      };
    };
    const trace = gd.data?.find((item) => item.name === 'NTC threshold');
    const xa = gd._fullLayout?.xaxis;
    const ya = gd._fullLayout?.yaxis;
    if (!trace?.x?.length || !trace.y?.length || !xa || !ya) return null;
    const box = gd.getBoundingClientRect();
    return {
      x: box.left + xa._offset + ((trace.x[0] - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length,
      y: box.top + ya._offset + ((ya.range[1] - trace.y[0]) / (ya.range[1] - ya.range[0])) * ya._length,
    };
  });
  expect(ntcCorner).not.toBeNull();
  const reclustered = page.waitForRequest(
    (request) => request.url().endsWith('/cluster') && request.method() === 'POST'
  );
  await page.mouse.move(ntcCorner!.x, ntcCorner!.y);
  await page.mouse.down();
  await page.mouse.move(ntcCorner!.x + 24, ntcCorner!.y - 18, { steps: 5 });
  await page.mouse.up();
  const clusterBody = (await reclustered).postDataJSON();
  expect(clusterBody.threshold_config.ntc_fam_max).toBeGreaterThan(0);
  expect(clusterBody.threshold_config.ntc_allele2_max).toBeGreaterThan(0);
  expect(clusterBody.threshold_config.boundaries).toBeNull();
});

test('dragging the NTC corner saves a two-channel threshold without freezing genotype rays', async ({ page }) => {
  await page.goto('/');
  const english = page.getByRole('button', { name: 'English' });
  if (await english.isVisible()) await english.click();
  await login(page);

  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith('/api/upload') && response.request().method() === 'POST'
  );
  await page.locator('#file-input').setInputFiles(CFX_AMPLIFICATION);
  const uploadBody = await (await uploaded).json();
  await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/);

  const wells = await page.locator('.plate-well:not(.empty)').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.well).filter(Boolean)
  );
  expect(wells.length).toBeGreaterThan(3);

  const created = await page.evaluate(
    async ({ sid, markerWells }) => {
      const response = await fetch(`/api/data/${sid}/markers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markers: [{ id: 'm1', name: 'Marker 1', wells: markerWells, ploidy: 2 }],
        }),
      });
      return response.ok;
    },
    { sid: uploadBody.session_id, markerWells: wells }
  );
  expect(created).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('markers-changed')));

  const plot = page.getByTestId('marker-scatter');
  await expect(plot).toBeVisible();
  // See the note in the first test: threshold edits are a mode now, so that a
  // selection box can be started anywhere on the canvas.
  await page.getByTestId('scatter-tool-edit').click();
  await plot.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const corner = await plot.evaluate((node) => {
    const gd = node as HTMLDivElement & {
      data?: Array<{ name?: string; x?: number[]; y?: number[] }>;
      _fullLayout?: {
        xaxis?: { _offset: number; _length: number; range: [number, number] };
        yaxis?: { _offset: number; _length: number; range: [number, number] };
      };
    };
    const trace = gd.data?.find((item) => item.name === 'NTC threshold');
    const xa = gd._fullLayout?.xaxis;
    const ya = gd._fullLayout?.yaxis;
    if (!trace?.x?.length || !trace.y?.length || !xa || !ya) return null;
    const box = gd.getBoundingClientRect();
    return {
      x: box.left + xa._offset + ((trace.x[0] - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length,
      y: box.top + ya._offset + ((ya.range[1] - trace.y[0]) / (ya.range[1] - ya.range[0])) * ya._length,
    };
  });
  expect(corner).not.toBeNull();

  const savedThreshold = page.waitForResponse(
    (response) => response.url().endsWith('/markers/m1') && response.request().method() === 'PUT'
  );
  await page.mouse.move(corner!.x, corner!.y);
  await page.mouse.down();
  await page.mouse.move(corner!.x + 35, corner!.y - 25, { steps: 6 });
  await page.mouse.up();
  const requestBody = (await savedThreshold).request().postDataJSON();

  expect(requestBody.threshold_config.ntc_fam_max).toBeGreaterThan(0);
  expect(requestBody.threshold_config.ntc_allele2_max).toBeGreaterThan(0);
  expect(requestBody.threshold_config.boundaries).toBeNull();
});
