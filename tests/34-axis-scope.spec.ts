import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { uploadAndWait } from './helpers';

// Axis scope: with "Same for plate" (default) every marker and every read shows
// the same x/y axis range; "Per marker" goes back to each marker's own range.
// Needs the server's /axis-bounds. Fixture is synthetic (tests/fixtures/stepone/make_fixtures.py).
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8402' });

const FIXTURE = path.join(__dirname, 'fixtures', 'stepone', 'stepone-partial-names.eds');

type PlotNode = HTMLElement & { layout?: { xaxis?: { range?: number[] }; yaxis?: { range?: number[] } } };

async function pickMarker(page: Page, name: string) {
  const chip = page.getByTestId('marker-chip').filter({ hasText: name });
  if (await chip.count()) await chip.click();
  else {
    const more = page.getByTestId('marker-chip-more');
    await more.selectOption(await more.locator('option').filter({ hasText: name }).getAttribute('value') ?? '');
  }
}

const ranges = (page: Page) =>
  page.getByTestId('marker-scatter').evaluate((node) => {
    const layout = (node as PlotNode).layout;
    return { x: [...(layout?.xaxis?.range ?? [])], y: [...(layout?.yaxis?.range ?? [])] };
  });

async function settledRanges(page: Page) {
  // Let the marker/read switch and the plot redraw finish.
  await page.waitForTimeout(600);
  return ranges(page);
}

test.describe('axis scope', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('snp-analyzer-language', JSON.stringify({ state: { language: 'en' }, version: 0 }));
      localStorage.removeItem('snp-analyzer-settings');
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uploadAndWait(page, FIXTURE);
    await page.locator('#tab-results').click();
    await expect(page.getByTestId('marker-scatter')).toBeVisible();
  });

  test('plate scope keeps the same axis range across markers and reads', async ({ page }) => {
    await expect(page.getByTestId('axis-scope-select')).toHaveValue('plate');
    await pickMarker(page, 'QPrism1');
    const first = await settledRanges(page);

    await pickMarker(page, 'QPrism2');
    const otherMarker = await settledRanges(page);
    expect(otherMarker).toEqual(first);

    await page.locator('#cycle-slider').focus();
    await page.keyboard.press('End');
    const otherRead = await settledRanges(page);
    expect(otherRead).toEqual(first);

    await pickMarker(page, 'QPrism1');
    expect(await settledRanges(page)).toEqual(first);
  });

  test('per marker scope uses each marker\'s own range', async ({ page }) => {
    await pickMarker(page, 'QPrism1');
    const plate = await settledRanges(page);

    await page.getByTestId('axis-scope-select').selectOption('marker');
    await expect(page.getByTestId('axis-scope-select')).toHaveValue('marker');
    const own = await settledRanges(page);
    // A marker's own wells cover less than the whole plate, so the range
    // differs (and is never wider than the plate-wide one).
    expect(own).not.toEqual(plate);
    expect(own.x[1] - own.x[0]).toBeLessThanOrEqual(plate.x[1] - plate.x[0] + 1e-6);

    await pickMarker(page, 'QPrism2');
    const markerTwo = await settledRanges(page);
    expect(markerTwo).not.toEqual(own);
  });
});
