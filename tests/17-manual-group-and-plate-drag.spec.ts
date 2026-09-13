import { expect, test, type Page, type Locator } from '@playwright/test';
import path from 'path';
import { login, uploadAndWait } from './helpers';

/** A viewport tall enough to hold the analysis grid without the plot falling
 *  below the fold -- these tests press on plot coordinates, they are not a
 *  responsive-layout check. */
const TALL_VIEWPORT = { width: 1600, height: 1200 };

/** Read `measure` until it returns the same result twice in a row, so a
 *  still-reflowing layout cannot hand back a stale position.
 *
 *  P13: `null` means "not rendered/measurable yet" (e.g. the NTC corner's
 *  Plotly trace hasn't been drawn by the async `Plotly.newPlot`/`react` call
 *  that follows a marker-scoped remount), not a real, stable value. Two
 *  consecutive `null` reads used to satisfy the "same twice in a row" check
 *  and return early -- a false "settled" signal that raced the mount/draw
 *  window documented in docs/planning/feedback-2026-09-11/evidence/P13-NTC-RACE.md.
 *  Only a non-null value may ever count as settled; `null` always keeps
 *  polling until `attempts` is exhausted. */
async function whenSettled<T>(
  page: Page,
  measure: () => Promise<T>,
  attempts = 20
): Promise<T> {
  let previous: string | null = null;
  for (let i = 0; i < attempts; i++) {
    const current = await measure();
    const key = JSON.stringify(current);
    if (current !== null && key === previous) return current;
    previous = key;
    await page.waitForTimeout(250);
  }
  return measure();
}

/** The NTC corner marker's position on screen, in viewport coordinates. */
function ntcCornerAt(plot: Locator) {
  return plot.evaluate((node) => {
    const gd = node as HTMLDivElement & {
      data?: Array<{ name?: string; x?: number[]; y?: number[] }>;
      _fullLayout?: {
        xaxis?: { _offset: number; _length: number; range: [number, number] };
        yaxis?: { _offset: number; _length: number; range: [number, number] };
      };
    };
    // Trace name was a hardcoded "NTC threshold" when this test was written;
    // 846b5c2 (P4-S3-T1) localized and pluralized it to t.chartNtcThreshold
    // ("NTC thresholds" in English, which this spec pins itself to).
    const trace = gd.data?.find((item) => item.name === 'NTC thresholds');
    const xa = gd._fullLayout?.xaxis;
    const ya = gd._fullLayout?.yaxis;
    if (!trace?.x?.length || !trace.y?.length || !xa || !ya) return null;
    const box = gd.getBoundingClientRect();
    return {
      x: Math.round(box.left + xa._offset + ((trace.x[0] - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length),
      y: Math.round(box.top + ya._offset + ((ya.range[1] - trace.y[0]) / (ya.range[1] - ya.range[0])) * ya._length),
    };
  });
}

const CFX_AMPLIFICATION = path.resolve(
  '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/CFX-opus',
  'admin_2026-02-16 11-12-20_783BR20183 -  Quantification Amplification Results.xlsx'
);

/** The login page's language toggle always shows exactly one of these two
 *  labels ("switch to X"), so waiting for either to appear -- rather than a
 *  single no-retry `isVisible()` read taken the instant `page.goto` resolves
 *  -- can't silently miss the switch if the app's async auth check is still
 *  deciding whether to render the login page at all.
 *
 *  P13: language-store.ts defaults to `'ko'`; a missed switch here doesn't
 *  just leave a few labels untranslated, it makes every `t.chartNtcThreshold`
 *  string this file pins itself to ("NTC thresholds") permanently unmatched
 *  for the rest of that test -- indistinguishable, without checking the
 *  actual trace names, from the async-mount race this file's `whenSettled`
 *  polls for. See docs/planning/feedback-2026-09-11/evidence/P13-NTC-RACE.md. */
async function ensureEnglish(page: Page) {
  const toggle = page.getByRole('button', { name: /^(English|한국어)$/ });
  await toggle.waitFor({ state: 'visible' });
  if ((await toggle.textContent())?.trim() === 'English') await toggle.click();
}

test('dragging from plate whitespace selects visible wells and assigns Group 1', async ({ page }) => {
  await page.setViewportSize(TALL_VIEWPORT);
  await page.goto('/');
  await ensureEnglish(page);
  await uploadAndWait(page, CFX_AMPLIFICATION);

  const panel = page.locator('.plate-panel');
  const grid = page.locator('#plate-grid');
  // Let the initial analysis land before measuring anything: it can add an
  // analysis-warning callout above the grid, and every coordinate below is
  // read from getBoundingClientRect, so a later reflow invalidates them.
  await expect(grid).toBeVisible();
  await grid.scrollIntoViewIfNeeded();
  await whenSettled(page, () => grid.boundingBox());
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

  // P2-S4's keyboard-grid contract (287ad3f) moved role="gridcell" wells from
  // aria-pressed to the ARIA-correct aria-selected; P4-S3-T1 (846b5c2) then
  // added a genotype-glyph span alongside the pre-existing checkmark badge
  // span, so "the one span in a selected well" is no longer a safe locator --
  // target the checkmark badge by its text instead.
  const selected = page.locator('.plate-well[aria-selected="true"]');
  expect(await selected.count()).toBeGreaterThan(1);
  await expect(selected.first()).toHaveClass(/ring-amber-400/);
  await expect(selected.first().locator('span', { hasText: '✓' })).toBeVisible();

  // P15-GROUP-MENU: the 6 preset buttons collapsed into a trigger + menu --
  // open it before picking "Group 1", instead of clicking a standing button.
  const groupTrigger = page.getByTestId('manual-group-trigger');
  await groupTrigger.click();
  const groupOne = page.getByTestId('manual-group-1');
  const savedGroup = page.waitForResponse(
    (response) => response.url().endsWith('/groups') && response.request().method() === 'POST'
  );
  await groupOne.click();
  const savedPayload = await (await savedGroup).json();
  expect(savedPayload.name).toBe('Group 1');
  expect(savedPayload.wells.length).toBeGreaterThan(1);
  // Selecting a group closes the menu, so the per-item aria-pressed check
  // that used to run against the standing button now runs against the
  // collapsed trigger first (equivalent guarantee: the current group is
  // displayed even with the menu closed).
  await expect(groupTrigger).toContainText(/Group 1|그룹 1/);
  // Re-open to confirm the row itself still carries the active state --
  // P13 (docs/planning/feedback-2026-09-11/evidence/P13-NTC-RACE.md) fixed
  // the actual cause of this test's old flakiness (whenSettled treating two
  // consecutive nulls as "settled", and a no-retry language-toggle read); an
  // earlier draft of this test attributed the flake to this extra
  // open/close pair instead and dropped it. With the real cause fixed, kept.
  await groupTrigger.click();
  await expect(groupOne).toHaveAttribute('aria-pressed', 'true');
  await expect(groupOne).toContainText(/Group 1|그룹 1/);
  await page.keyboard.press('Escape');

  // Moving the NTC corner is now an explicit mode. A drag used to mean BOTH
  // "select wells" and "move the nearest threshold" at once, and the threshold
  // handler won -- it swallowed any mousedown within 18px of this corner
  // marker before Plotly saw it, and that marker sits inside the data cloud on
  // a raw endpoint plate. Selecting had to be the default; editing asks.
  // Moving the NTC corner is now an explicit mode. A drag used to mean BOTH
  // "select wells" and "move the nearest threshold" at once, and the threshold
  // handler won -- it swallowed any mousedown within 18px of this corner
  // marker before Plotly saw it, and that marker sits inside the data cloud on
  // a raw endpoint plate. Selecting had to be the default; editing asks.
  const scatter = page.locator('#scatter-plot');
  await page.getByTestId('scatter-tool-edit').click();
  await scatter.scrollIntoViewIfNeeded();
  const ntcCorner = await whenSettled(page, () => ntcCornerAt(scatter));
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
  await page.setViewportSize(TALL_VIEWPORT);
  await page.goto('/');
  await ensureEnglish(page);
  await login(page);

  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith('/api/upload') && response.request().method() === 'POST'
  );
  await page.locator('#file-input').setInputFiles(CFX_AMPLIFICATION);
  const uploadBody = await (await uploaded).json();
  await expect(page.locator('#analysis-panel')).not.toHaveClass(/hidden/);

  // PlateView fetches well data through its own effect (getPlate), a second
  // round trip after /api/upload -- #analysis-panel unhides as soon as the
  // session exists, before that fetch resolves, so every .plate-well starts
  // out carrying the empty placeholder class. Wait for it to clear instead
  // of reading the grid on the same tick the panel appears.
  await expect(page.locator('.plate-well:not(.empty)').first()).toBeVisible({ timeout: 15000 });
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
  // See the note in the first test: threshold edits are a mode now, so that a
  // selection box can be started anywhere on the canvas.
  await page.getByTestId('scatter-tool-edit').click();
  await plot.scrollIntoViewIfNeeded();
  const corner = await whenSettled(page, () => ntcCornerAt(plot));
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
