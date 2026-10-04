import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { uploadAndWait } from './helpers';

// Multi-well amplification curves (docs/planning/multi-well-curves-2026-10-04/PLAN.md §6)
// and the right-click allele popup in the marker view (2fafd17).
//
// Fixtures:
// - QuantStudio 3 multicomponent export: 32 wells, 25 cycles, single-marker view.
//   Calls used here: A5 Allele 1 Homo, B6 Heterozygous, G6 Allele 2 Homo.
// - StepOnePlus synthetic run with user allele names (tests/fixtures/stepone):
//   marker QPrism1 owns columns 1-2 with names REF1 (FAM) / MUT1 (VIC);
//   A1 REF1/REF1, A2 REF1/MUT1, B2 MUT1/MUT1, A3 belongs to QPrism2.
// - A 384-well QuantStudio raw .eds written before the run by the backend's own
//   synthetic generator (snp-analyzer/tests/quantstudio_fixtures.py, stdlib only).
const QS_MULTICOMPONENT = '/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/Quantstudio3/ASG-PCR-NTCtest_Multicomponent Data.xls';
const STEPONE_USER = path.join(__dirname, 'fixtures', 'stepone', 'stepone-user-names.eds');
const PLATE_384 = path.join(os.tmpdir(), 'qprism-e2e-plate-384.eds');
// Review screenshots go to E2E_SHOTS_DIR when set, else to the test's output folder.
const shot = (name: string) => process.env.E2E_SHOTS_DIR
  ? path.join(process.env.E2E_SHOTS_DIR, name) : test.info().outputPath(name);

const FAM_COLOR = '#2563eb';
const ALLELE2_COLOR = '#dc2626';
const RENDER_BUDGET_MS = 1500;

type Trace = {
  name?: string;
  meta?: { well: string | null; channel: 'fam' | 'allele2'; group: string };
  line?: { color?: string; dash?: string; width?: number };
  opacity?: number;
  x?: (number | null)[];
  y?: (number | null)[];
  text?: string[];
  showlegend?: boolean;
};
type PlotNode = HTMLElement & {
  data?: Trace[];
  layout?: { yaxis?: { type?: string }; shapes?: { x0?: number }[]; paper_bgcolor?: string };
};

test.beforeAll(() => {
  if (fs.existsSync(PLATE_384)) return;
  const script = [
    'import sys, quantstudio_fixtures as q',
    "q.write_quantstudio_eds(sys.argv[1], q.QuantStudioOptions(rows=16, cols=24, markers=('M1',), wells_per_marker=384))",
  ].join('\n');
  execFileSync(process.env.E2E_PYTHON ?? 'python3', ['-c', script, PLATE_384], {
    cwd: path.join(__dirname, '..', 'snp-analyzer', 'tests'),
  });
});

async function openCurves(page: Page, file: string) {
  await page.addInitScript(() =>
    localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await uploadAndWait(page, file);
  await page.locator('#tab-results').click();
  await page.getByTestId('plot-view-curve').click();
  await expect(page.getByTestId('plot-view-curve')).toHaveAttribute('aria-pressed', 'true');
}

const plateWell = (page: Page, well: string) => page.locator(`.plate-well[data-well="${well}"]`);

async function selectWells(page: Page, wells: string[]) {
  await plateWell(page, wells[0]).click();
  for (const well of wells.slice(1)) await plateWell(page, well).click({ modifiers: ['Control'] });
}

const traces = (page: Page) =>
  page.locator('#amplification-plot').evaluate((node) =>
    ((node as PlotNode).data ?? []).map((t) => ({
      name: t.name ?? '',
      well: t.meta?.well ?? null,
      channel: t.meta?.channel ?? null,
      color: t.line?.color ?? null,
      dash: t.line?.dash ?? null,
      // Merged traces hold many wells; their hover text starts with the well.
      wells: [...new Set((t.text ?? []).map((s) => s.split(' · ')[0]).filter(Boolean))],
    })));

/** Wells drawn in the curve plot, sorted; per-well traces carry `meta.well`. */
async function plottedWells(page: Page) {
  const all = new Set<string>();
  for (const t of await traces(page)) {
    if (t.well) all.add(t.well);
    for (const w of t.wells) all.add(w);
  }
  return [...all].sort();
}

const layout = (page: Page) =>
  page.locator('#amplification-plot').evaluate((node) => {
    const l = (node as PlotNode).layout;
    return { yType: l?.yaxis?.type, x0: l?.shapes?.[0]?.x0 ?? null, paper: l?.paper_bgcolor };
  });

/** Counts curve requests (`/amplification`, not `/amplification/all`) from now on. */
function countCurveRequests(page: Page) {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/data\/[^/]+\/amplification(\?|$)/.test(request.url())) seen.push(request.url());
  });
  return seen;
}

test.describe('multi-well amplification curves (QuantStudio, single-marker view)', () => {
  test.beforeEach(async ({ page }) => { await openCurves(page, QS_MULTICOMPONENT); });

  test('one well keeps the two-line curve with only the scale control', async ({ page }) => {
    await plateWell(page, 'A5').click();
    await expect.poll(() => plottedWells(page)).toEqual(['A5']);
    const drawn = await traces(page);
    expect(drawn.map((t) => [t.channel, t.color])).toEqual([['fam', FAM_COLOR], ['allele2', ALLELE2_COLOR]]);
    // The single-well lines are plain: no dash, named by channel only.
    expect(drawn.every((t) => t.dash === null)).toBe(true);
    expect(drawn.map((t) => t.name)).toEqual(['WT (FAM)', 'MT1 (VIC)']);
    await expect(page.getByTestId('curve-selected-count')).toHaveCount(0);
    await expect(page.getByTestId('curve-channels')).toHaveCount(0);
    await expect(page.getByTestId('curve-colour-basis')).toHaveCount(0);
    await expect(page.getByTestId('curve-yscale-linear')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('curve-yscale-log')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('well-detail-multi-note')).toHaveCount(0);
  });

  test('three wells draw together: channel colours, FAM solid, Allele 2 dashed, hover emphasis', async ({ page }) => {
    await selectWells(page, ['A5', 'B6', 'G6']);
    await expect(page.getByTestId('curve-selected-count')).toHaveText('3 wells selected');
    await expect.poll(() => plottedWells(page)).toEqual(['A5', 'B6', 'G6']);
    await expect(page.getByTestId('curve-colour-basis-channel')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('curve-channels-both')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('well-detail-multi-note')).toHaveText('3 wells selected — compare them in the curve view');
    await expect(page.getByTestId('curve-summary')).toHaveText(/^3 wells shown/);

    const drawn = await traces(page);
    expect(drawn).toHaveLength(6);
    const fam = drawn.filter((t) => t.channel === 'fam');
    const allele2 = drawn.filter((t) => t.channel === 'allele2');
    expect(fam.map((t) => t.well).sort()).toEqual(['A5', 'B6', 'G6']);
    expect(allele2.map((t) => t.well).sort()).toEqual(['A5', 'B6', 'G6']);
    for (const t of fam) expect([t.color, t.dash]).toEqual([FAM_COLOR, 'solid']);
    for (const t of allele2) expect([t.color, t.dash]).toEqual([ALLELE2_COLOR, 'dash']);
    expect(new Set(drawn.map((t) => t.name))).toEqual(new Set(['WT (FAM) (3)', 'MT1 (VIC) (3)']));

    // Hover the point of B6 that sits farthest from every other line: B6's two
    // lines thicken and the other wells fade.
    const target = await page.locator('#amplification-plot').evaluate((node) => {
      const gd = node as PlotNode & { _fullLayout: { xaxis: Axis; yaxis: Axis } };
      type Axis = { l2p: (v: number) => number; _offset: number };
      const box = gd.getBoundingClientRect();
      const px = (i: number, t: Trace) => ({
        x: box.left + gd._fullLayout.xaxis._offset + gd._fullLayout.xaxis.l2p(t.x![i]!),
        y: box.top + gd._fullLayout.yaxis._offset + gd._fullLayout.yaxis.l2p(t.y![i]!),
      });
      let best = { gap: -1, x: 0, y: 0 };
      for (const t of gd.data!.filter((d) => d.meta?.well === 'B6')) {
        for (let i = 0; i < t.x!.length; i += 1) {
          if (t.y![i] === null) continue;
          const p = px(i, t);
          const gap = Math.min(...gd.data!.filter((o) => o.meta?.well !== 'B6' && o.y![i] !== null)
            .map((o) => Math.hypot(px(i, o).x - p.x, px(i, o).y - p.y)));
          if (gap > best.gap) best = { gap, ...p };
        }
      }
      return best;
    });
    expect(target.gap).toBeGreaterThan(10);
    await page.mouse.move(target.x, target.y);
    await expect.poll(() => page.locator('#amplification-plot').evaluate((node) =>
      ((node as PlotNode).data ?? []).map((t) => [t.meta?.well, t.line?.width, t.opacity]))).toEqual([
      ['A5', 1.5, 0.2], ['A5', 1.5, 0.2], ['B6', 3.5, 1], ['B6', 3.5, 1], ['G6', 1.5, 0.2], ['G6', 1.5, 0.2],
    ]);
  });

  test('channel filter, call colouring, and the 12-well limit on well colouring', async ({ page }) => {
    await selectWells(page, ['A5', 'B6', 'G6']);
    await expect.poll(() => plottedWells(page)).toEqual(['A5', 'B6', 'G6']);

    await page.getByTestId('curve-channels-fam').click();
    await expect.poll(async () => (await traces(page)).map((t) => t.channel)).toEqual(['fam', 'fam', 'fam']);
    await page.getByTestId('curve-channels-allele2').click();
    await expect.poll(async () => (await traces(page)).map((t) => t.channel)).toEqual(['allele2', 'allele2', 'allele2']);
    await page.getByTestId('curve-channels-both').click();
    await expect.poll(async () => (await traces(page)).length).toBe(6);

    // Call colouring: one legend group per call, named by the call, coloured by it.
    await page.getByTestId('curve-colour-basis-call').click();
    await expect(page.getByTestId('curve-colour-basis-call')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await traces(page)).map((t) => `${t.well} ${t.name}`).sort()).toEqual([
      'A5 MT1 (VIC) · Hom-1 (1)', 'A5 WT (FAM) · Hom-1 (1)',
      'B6 MT1 (VIC) · Het (1)', 'B6 WT (FAM) · Het (1)',
      'G6 MT1 (VIC) · Hom-2 (1)', 'G6 WT (FAM) · Hom-2 (1)',
    ]);
    const byCall = await traces(page);
    const colourOf = (well: string) => new Set(byCall.filter((t) => t.well === well).map((t) => t.color));
    for (const well of ['A5', 'B6', 'G6']) expect(colourOf(well).size).toBe(1);
    expect(new Set(byCall.map((t) => t.color)).size).toBe(3);
    // Each call keeps the colour the plate gives it. (The homozygous call colours
    // happen to equal the channel colours; three distinct colours across both
    // channels is what the channel basis cannot produce.)
    for (const well of ['A5', 'B6', 'G6']) {
      const plateColour = await plateWell(page, well).evaluate((node) => {
        const [r, g, b] = getComputedStyle(node).backgroundColor.match(/\d+/g)!.map(Number);
        return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      });
      expect(colourOf(well), well).toEqual(new Set([plateColour]));
    }
    await expect(page.getByTestId('curve-summary')).toHaveText('3 wells shown: Hom-1 1, Het 1, Hom-2 1');

    // Well colouring: allowed at 3 wells, one colour and one legend entry (the well ID) per well.
    await expect(page.getByTestId('curve-colour-basis-well')).toBeEnabled();
    await page.getByTestId('curve-colour-basis-well').click();
    await expect.poll(async () => (await traces(page)).map((t) => `${t.well} ${t.name}`)).toEqual([
      'A5 A5', 'A5 A5', 'B6 B6', 'B6 B6', 'G6 G6', 'G6 G6',
    ]);
    const byWell = await traces(page);
    expect(new Set(byWell.map((t) => t.color)).size).toBe(3);

    // 16 wells (A5 to D8): well colouring is disabled and the view falls back to channel colours.
    await plateWell(page, 'A5').click();
    await plateWell(page, 'D8').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('curve-selected-count')).toHaveText('16 wells selected');
    await expect(page.getByTestId('curve-colour-basis-well')).toBeDisabled();
    await expect(page.getByTestId('curve-colour-basis-channel')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => plottedWells(page)).toHaveLength(16);
    const fallback = await traces(page);
    for (const t of fallback) expect(t.color).toBe(t.channel === 'fam' ? FAM_COLOR : ALLELE2_COLOR);
  });

  test('moving the cycle moves only the marker line, without refetching curves', async ({ page }) => {
    for (const wells of [['A5'], ['A5', 'B6', 'G6']]) {
      await selectWells(page, wells);
      await expect.poll(() => plottedWells(page)).toEqual(wells);
      const before = await layout(page);
      expect(before.x0).toBe(25);

      const requests = countCurveRequests(page);
      const slider = page.locator('#cycle-slider');
      await slider.focus();
      await page.keyboard.press('Home');
      await expect(page.locator('#cycle-value')).toHaveText('1');
      await expect.poll(async () => (await layout(page)).x0).toBe(1);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await layout(page)).x0).toBe(3);
      // Longer than the 150 ms selection debounce: any refetch would have started.
      await page.waitForTimeout(800);
      expect(requests, `curve requests after cycle changes with ${wells.length} well(s)`).toEqual([]);
      expect(await plottedWells(page)).toEqual(wells);
      await page.keyboard.press('End');
      await expect.poll(async () => (await layout(page)).x0).toBe(25);
      page.removeAllListeners('request');
    }
  });

  test('log scale applies to one and to several wells and switches back', async ({ page }) => {
    await plateWell(page, 'A5').click();
    await expect.poll(() => plottedWells(page)).toEqual(['A5']);
    expect((await layout(page)).yType).toBe('linear');
    await page.getByTestId('curve-yscale-log').click();
    await expect(page.getByTestId('curve-yscale-log')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await layout(page)).yType).toBe('log');

    // The choice is kept when the selection grows to several wells.
    await selectWells(page, ['A5', 'B6', 'G6']);
    await expect.poll(() => plottedWells(page)).toEqual(['A5', 'B6', 'G6']);
    expect((await layout(page)).yType).toBe('log');
    // Points at or below zero cannot sit on a log axis: they are dropped and counted.
    const hidden = await page.locator('#amplification-plot').evaluate((node) =>
      ((node as PlotNode).data ?? []).reduce((n, t) => n + (t.y ?? []).filter((v) => v === null).length, 0));
    if (hidden > 0) await expect(page.getByTestId('curve-hidden-nonpositive')).toContainText(String(hidden));
    else await expect(page.getByTestId('curve-hidden-nonpositive')).toHaveCount(0);
    // The cycle marker line stays on the log axis.
    expect((await layout(page)).x0).toBe(25);

    await page.getByTestId('curve-yscale-linear').click();
    await expect.poll(async () => (await layout(page)).yType).toBe('linear');
    await expect(page.getByTestId('curve-hidden-nonpositive')).toHaveCount(0);
  });

  test('screenshots: three wells in light and dark, expert switch off and on', async ({ page }) => {
    await selectWells(page, ['A5', 'B6', 'G6']);
    await expect.poll(() => plottedWells(page)).toEqual(['A5', 'B6', 'G6']);
    const lightPaper = (await layout(page)).paper;
    await page.screenshot({ path: shot('curves-3-wells-light.png') });
    await expect(page.getByTestId('expert-mode-toggle')).toHaveAttribute('aria-checked', 'false');
    await page.screenshot({ path: shot('expert-off.png'), fullPage: true });
    await page.getByTestId('expert-mode-toggle').click();
    await expect(page.getByTestId('expert-mode-toggle')).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: shot('expert-on.png'), fullPage: true });

    // The app's own dark toggle (keyboard "d"), not the OS preference.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('d');
    await expect(page.locator('body')).toHaveClass(/dark/);
    await expect.poll(async () => (await layout(page)).paper).not.toBe(lightPaper);
    await expect.poll(() => plottedWells(page)).toEqual(['A5', 'B6', 'G6']);
    await page.screenshot({ path: shot('curves-3-wells-dark.png') });
  });
});

test('384 wells selected at once render within budget and warn about overlap', async ({ page }) => {
  await openCurves(page, PLATE_384);
  await plateWell(page, 'A1').click();
  await expect.poll(() => plottedWells(page)).toEqual(['A1']);

  // From the click to the moment every well's lines are in the plot's SVG.
  await page.evaluate(() => {
    type W = Window & { __curveTiming?: Promise<Record<string, number | boolean>> };
    const gd = document.getElementById('amplification-plot') as PlotNode;
    const t0 = performance.now();
    (window as W).__curveTiming = new Promise((resolve) => {
      const tick = () => {
        const wells = new Set<string>();
        for (const t of gd.data ?? []) for (const s of t.text ?? []) if (s) wells.add(s.split(' · ')[0]);
        const lines = gd.querySelectorAll('.scatterlayer .trace path.js-line').length;
        if (wells.size >= 384 && lines >= (gd.data ?? []).length) {
          const done = performance.now();
          const res = performance.getEntriesByType('resource')
            .filter((e) => /\/amplification\?/.test(e.name) && e.startTime >= t0) as PerformanceResourceTiming[];
          const responseEnd = res.length ? res[res.length - 1].responseEnd : NaN;
          resolve({ totalMs: done - t0, responseMs: responseEnd - t0, renderMs: done - responseEnd, requests: res.length, traces: (gd.data ?? []).length });
        } else if (performance.now() - t0 > 30000) resolve({ timedOut: true, wells: wells.size });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await plateWell(page, 'P24').click({ modifiers: ['Shift'] });
  const timing = await page.evaluate(() => (window as Window & { __curveTiming?: Promise<Record<string, number | boolean>> }).__curveTiming);
  const report = JSON.stringify(timing);
  console.log(`384-well curve timing: ${report}`);
  test.info().annotations.push({ type: 'perf', description: report });

  expect(timing?.timedOut).toBeUndefined();
  expect(timing?.requests).toBe(1);
  expect(timing?.renderMs as number).toBeLessThanOrEqual(RENDER_BUDGET_MS);
  await expect(page.getByTestId('curve-selected-count')).toHaveText('384 wells selected');
  expect(await plottedWells(page)).toHaveLength(384);
  // Above 24 wells the lines merge into one trace per channel group.
  const drawn = await traces(page);
  expect(drawn.map((t) => [t.channel, t.well])).toEqual([['fam', null], ['allele2', null]]);
  await expect(page.getByTestId('curve-overlap-note')).toBeVisible();
  await expect(page.getByTestId('curve-colour-basis-well')).toBeDisabled();
  await expect(page.getByTestId('curve-missing-wells')).toHaveCount(0);
});

test.describe('marker view (StepOnePlus, user allele names)', () => {
  test.beforeEach(async ({ page }) => { await openCurves(page, STEPONE_USER); });

  test('call colouring names groups with the marker alleles and puts other markers\' wells in Unassigned', async ({ page }) => {
    await selectWells(page, ['A1', 'A2', 'B2', 'A3']);
    await expect.poll(() => plottedWells(page)).toEqual(['A1', 'A2', 'A3', 'B2']);
    await page.getByTestId('curve-colour-basis-call').click();
    await expect.poll(async () => (await traces(page))
      .filter((t) => t.channel === 'fam')
      .map((t) => `${t.well} ${t.name.split(' · ')[1]}`).sort()).toEqual([
      'A1 REF1/REF1 (1)', 'A2 REF1/MUT1 (1)', 'A3 Unassigned (1)', 'B2 MUT1/MUT1 (1)',
    ]);
    const unassigned = (await traces(page)).filter((t) => t.well === 'A3');
    expect(new Set(unassigned.map((t) => t.color))).toEqual(new Set(['#9ca3af']));
  });
});

test.describe('right-click allele popup (marker view)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uploadAndWait(page, STEPONE_USER);
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('marker-scatter')).toBeVisible();
  });

  const popup = (page: Page) => page.getByRole('menu');

  test('a plate well opens the popup with the marker\'s allele names; Escape closes it', async ({ page }) => {
    await plateWell(page, 'A1').click({ button: 'right' });
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toHaveAccessibleName('Assign type to 1 well');
    for (const name of ['REF1/REF1', 'REF1/MUT1', 'MUT1/MUT1']) {
      await expect(popup(page).getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
  });

  test('a hovered scatter point opens the popup for that well', async ({ page }) => {
    const scatter = page.getByTestId('marker-scatter');
    const point = await scatter.evaluate((node) => {
      type Axis = { l2p: (v: number) => number; _offset: number };
      const gd = node as HTMLElement & {
        data: { x: number[]; y: number[]; customdata?: string[] }[];
        _fullLayout: { xaxis: Axis; yaxis: Axis };
      };
      const box = gd.getBoundingClientRect();
      for (const t of gd.data) {
        const i = (t.customdata ?? []).indexOf('B2');
        if (i >= 0) {
          return {
            x: box.left + gd._fullLayout.xaxis._offset + gd._fullLayout.xaxis.l2p(t.x[i]),
            y: box.top + gd._fullLayout.yaxis._offset + gd._fullLayout.yaxis.l2p(t.y[i]),
          };
        }
      }
      return null;
    });
    expect(point).not.toBeNull();
    await page.mouse.move(point!.x, point!.y);
    await expect(scatter).toHaveAttribute('data-hover-well', 'B2');
    await page.mouse.click(point!.x, point!.y, { button: 'right' });
    await expect(popup(page)).toHaveAccessibleName('Assign type to 1 well');

    // Assigning from the popup lands on B2 and nowhere else.
    await popup(page).getByRole('menuitem', { name: 'Undetermined', exact: true }).click();
    await expect(popup(page)).toHaveCount(0);
    await expect(plateWell(page, 'B2')).toHaveAttribute('title', /Call: Undetermined/);
    await expect(plateWell(page, 'A1')).toHaveAttribute('title', /Call: REF1\/REF1/);
  });

  test('right-clicks outside the plate and scatter keep the browser menu even with a well selected', async ({ page }) => {
    await plateWell(page, 'A1').click();
    await expect(plateWell(page, 'A1')).toHaveClass(/selected/);
    await page.locator('#instrument-badge').click({ button: 'right' });
    await page.getByTestId('genotype-counts').click({ button: 'right' });
    await page.getByTestId('marker-chip-bar').click({ button: 'right' });
    await expect(popup(page)).toHaveCount(0);
    // The same selection on the plate does open it, for the selected well.
    await plateWell(page, 'A2').click({ button: 'right' });
    await expect(popup(page)).toHaveAccessibleName('Assign type to 1 well');
  });
});

test('single-marker view: with a well selected, only the plate and scatter open the popup', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 })));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await uploadAndWait(page, QS_MULTICOMPONENT);
  await page.locator('#tab-results').click();
  await plateWell(page, 'A5').click();
  await expect(plateWell(page, 'A5')).toHaveClass(/selected/);
  // Before 2fafd17 any right-click on the page opened it for the selection.
  await page.locator('#instrument-badge').click({ button: 'right' });
  await page.getByTestId('genotype-counts').click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await plateWell(page, 'B6').click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveAccessibleName('Assign type to 1 well');
});
