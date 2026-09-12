import { test, expect, type Page } from "@playwright/test";
import { loadExample } from "./helpers/load-example";

/**
 * P4-S1 — Plate Setup surface (`Plate 설정` tab).
 *
 * UX source: docs/multi-marker-ux-decision.md
 *   §0    2-surface workspace: `Plate(setup)` + `Analysis`, always both
 *         present, free back-and-forth (no wizard gate).
 *   §3    "Paint" ergonomics superseded by the confirmed §3.5 flow below;
 *         column/row header select + shift-range still required (§3 fable).
 *   §3.5  (user-confirmed, mockup iteration)
 *         - 마커는 0개로 시작 · 직접 추가 (이름 직접 입력, 프리셋 금지)
 *         - 마커 색상 직접 선택 (팔레트)
 *         - 미지정/비활성 웰 = 회색; 배정 시 마커 색으로 "켜짐"; 웰 클릭 = 선택 토글
 *         - 주 동선 = 웰 선택 → 마커 선택 → 배정(Apply) (Paint 모드 아님)
 *         - 웰별 샘플 타입: 샘플 / NTC / Allele 1 대조 / Allele 2 대조 / 이형접합 대조
 *   §3    C6  No-Amp/제외 웰 타입 신설 (실패 웰이 sample로 남아 클러스터 오염하는 것 방지)
 *
 * Mockup: docs/mockups/multimarker-mockup.html (#markerList, #plate, #inspBody)
 *
 * RED-first: none of the `data-testid`s below exist in the current UI. See
 * README-e2e.md for the full contract the P4 implementation must satisfy.
 */

async function goToPlateSetup(page: Page) {
  await page.locator("#tab-plate").click();
  await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();
  await expect(page.getByTestId("workspace-panel-plate").getByTestId("analysis-scope-counts")).toBeVisible();
}

test.describe("P4-S1: Plate Setup tab", () => {
  test.beforeEach(async ({ page }) => {
    // Hexaploid example: matches the decision-doc's worked qSwet5.3/qTotal11.1
    // examples (6배체 → up to 7 dosage classes).
    await loadExample(page, 6);
    await goToPlateSetup(page);
  });

  test("two-surface tabs exist: 플레이트 설정 / 결과, freely switchable", async ({ page }) => {
    await expect(page.locator("#tab-plate")).toContainText("플레이트 설정");
    await expect(page.locator("#tab-results")).toContainText("결과");

    await page.locator("#tab-results").click();
    await expect(page.getByTestId("workspace-panel-analysis")).toBeVisible();

    // Free round-trip, not a one-way wizard step.
    await page.locator("#tab-plate").click();
    await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();
  });

  test("unassigned wells render gray (data-assigned=false) by default", async ({ page }) => {
    const well = page.getByTestId("well-A1");
    await expect(well).toBeVisible();
    await expect(well).toHaveAttribute("data-assigned", "false");
  });

  test("parsed sample names are visible in the plate and editable in the inspector", async ({ page }) => {
    await expect(page.getByTestId("well-sample-A1")).toBeVisible();
    const parsedName = (await page.getByTestId("well-sample-A1").textContent())?.trim();
    expect(parsedName).toBeTruthy();

    await page.getByTestId("well-A1").click();
    await expect(page.getByTestId("sample-name-input")).toHaveValue(parsedName ?? "");
    await expect(page.getByText("파일에서 가져옴")).toBeVisible();

    await page.getByTestId("sample-name-input").fill("Edited sample");
    await page.getByTestId("sample-name-input").press("Enter");
    await expect(page.getByTestId("well-sample-A1")).toHaveText("Edited sample");
  });

  test("clicking a well toggles selection on/off", async ({ page }) => {
    const well = page.getByTestId("well-A1");
    await well.click();
    await expect(well).toHaveAttribute("aria-pressed", "true");
    await well.click();
    await expect(well).toHaveAttribute("aria-pressed", "false");
  });

  test("column header click selects/toggles the whole column", async ({ page }) => {
    await page.getByTestId("col-header-1").click();
    for (const row of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      await expect(page.getByTestId(`well-${row}1`)).toHaveAttribute("aria-pressed", "true");
    }

    // Clicking again toggles the whole column back off.
    await page.getByTestId("col-header-1").click();
    await expect(page.getByTestId("well-A1")).toHaveAttribute("aria-pressed", "false");
  });

  test("row header click selects/toggles the whole row", async ({ page }) => {
    await page.getByTestId("row-header-A").click();
    for (let c = 1; c <= 12; c++) {
      await expect(page.getByTestId(`well-A${c}`)).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("Shift-click selects a rectangular range and the corner control selects all wells", async ({ page }) => {
    await page.getByTestId("well-A1").click();
    await page.getByTestId("well-C3").click({ modifiers: ["Shift"] });

    for (const row of ["A", "B", "C"]) {
      for (const col of [1, 2, 3]) {
        await expect(page.getByTestId(`well-${row}${col}`)).toHaveAttribute("aria-pressed", "true");
      }
    }
    await expect(page.getByTestId("well-D4")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("select-all-wells").click();
    await expect(page.getByTestId("well-H12")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("select-all-wells").click();
    await expect(page.getByTestId("well-A1")).toHaveAttribute("aria-pressed", "false");
  });

  test("dragging across wells selects their rectangular block", async ({ page }) => {
    const start = await page.getByTestId("well-A1").boundingBox();
    if (!start) throw new Error("Plate wells must be visible for drag selection");

    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    // Selecting the first well inserts the selection toolbar above the grid.
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    const end = await page.getByTestId("well-C3").boundingBox();
    if (!end) throw new Error("Drag destination must remain visible");
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId("selection-count")).toContainText("9");
    await expect(page.getByTestId("well-C3")).toHaveAttribute("aria-pressed", "true");
  });

  test("creating a marker: name + color picker + ploidy", async ({ page }) => {
    await page.getByTestId("add-marker-button").click();
    const form = page.getByTestId("marker-form");
    await expect(form).toBeVisible();

    await page.getByTestId("marker-name-input").fill("qSwet5.3");
    await page.getByTestId("marker-color-swatch-0").click();
    await expect(page.getByTestId("marker-color-swatch-0")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("marker-ploidy-select").selectOption("6");
    await page.getByTestId("marker-form-save").click();

    await expect(form).toBeHidden();
    const card = page.getByTestId("marker-card").filter({ hasText: "qSwet5.3" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("6배체");
  });

  test("markers start at zero — no preset/auto marker exists", async ({ page }) => {
    await expect(page.getByTestId("marker-card")).toHaveCount(0);
    await expect(page.getByTestId("add-marker-button")).toBeVisible();
  });

  test("select wells → pick marker → 배정 (apply) assigns them", async ({ page }) => {
    await page.getByTestId("add-marker-button").click();
    await page.getByTestId("marker-name-input").fill("qTotal11.1");
    await page.getByTestId("marker-ploidy-select").selectOption("6");
    await page.getByTestId("marker-form-save").click();

    await page.getByTestId("well-A1").click();
    await page.getByTestId("well-A2").click();

    const bar = page.getByTestId("selection-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("selection-count")).toContainText("2");

    await bar
      .getByTestId("marker-pick-button")
      .filter({ hasText: "qTotal11.1" })
      .click();
    await page.getByTestId("assign-button").click();

    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "true");
    await expect(page.getByTestId("well-A2")).toHaveAttribute("data-assigned", "true");
    // Selection clears after a successful apply.
    await expect(page.getByTestId("selection-bar")).toBeHidden();
  });

  test("per-well sample type: 샘플 / NTC / Allele 1 / Allele 2 / 이형접합 / No-Amp", async ({
    page,
  }) => {
    await page.getByTestId("well-A1").click();
    const inspector = page.getByTestId("well-inspector");
    await expect(inspector).toBeVisible();

    for (const testId of [
      "well-type-sample",
      "well-type-ntc",
      "well-type-a1",
      "well-type-a2",
      "well-type-het",
      "well-type-no-amp",
    ]) {
      await expect(inspector.getByTestId(testId)).toBeVisible();
    }

    await inspector.getByTestId("well-type-a1").click();
    await expect(inspector.getByTestId("well-type-a1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("unassigning selected wells returns them to gray/unassigned", async ({ page }) => {
    await page.getByTestId("add-marker-button").click();
    await page.getByTestId("marker-name-input").fill("qSwet5.3");
    await page.getByTestId("marker-ploidy-select").selectOption("6");
    await page.getByTestId("marker-form-save").click();

    await page.getByTestId("well-A1").click();
    await page
      .getByTestId("selection-bar")
      .getByTestId("marker-pick-button")
      .filter({ hasText: "qSwet5.3" })
      .click();
    await page.getByTestId("assign-button").click();
    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "true");

    await page.getByTestId("well-A1").click();
    await page.getByTestId("well-inspector").getByTestId("unassign-button").click();
    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "false");
  });

  test("zero markers mean whole-plate analysis without an unassigned exclusion warning", async ({
    page,
  }) => {
    const panel = page.getByTestId("workspace-panel-plate");
    await expect(panel.getByTestId("unassigned-banner")).toHaveCount(0);
    await expect(panel.getByTestId("whole-plate-banner")).toContainText("전체 플레이트를 하나의 마커");
    await expect(panel.getByTestId("analysis-scope-counts")).toContainText("입력 웰: 96");

    // Analysis tab must remain reachable — unassigned wells never block work.
    await page.locator("#tab-results").click();
    await expect(page.getByTestId("workspace-panel-analysis")).toBeVisible();
  });

  test('S4 live marker transitions keep role exclusions separate and allow Omit recovery', async ({ page }) => {
    const sid = new URL(page.url()).searchParams.get('session');
    expect(sid).toBeTruthy();
    const panel = page.getByTestId('workspace-panel-plate');
    const marker = (id: string, wells: string[]) => ({ id, name: id, wells, ploidy: 6, color: '#abcdef' });
    for (const [markers, count] of [[ [marker('m1', ['A1'])], 95 ], [ [marker('m1', ['A1']), marker('m2', ['A2'])], 94 ]] as const) {
      expect((await page.request.post(`/api/data/${sid}/markers`, { data: { markers } })).ok()).toBeTruthy();
      await page.evaluate(() => window.dispatchEvent(new Event('markers-changed')));
      await expect(panel.getByTestId('unassigned-count')).toContainText(`웰 ${count}개`);
    }
    expect((await page.request.post(`/api/data/${sid}/welltypes`, { data: { wells: ['A1'], well_type: 'Omit' } })).ok()).toBeTruthy();
    await page.evaluate(() => window.dispatchEvent(new Event('welltypes-changed')));
    await expect(panel.getByTestId('analysis-scope-counts')).toContainText('Omit: 1');
    await panel.getByTestId('well-A1').focus();
    await expect(panel.getByTestId('well-A1')).toBeFocused();
    await panel.getByTestId('well-A1').click();
    await expect(panel.getByTestId('well-A1')).toHaveAttribute('aria-pressed', 'true');
    await panel.getByTestId('well-type-sample').click();
    await expect(panel.getByTestId('analysis-scope-counts')).toContainText('Omit: 0');
    expect((await page.request.post(`/api/data/${sid}/markers`, { data: { markers: [] } })).ok()).toBeTruthy();
    await page.evaluate(() => window.dispatchEvent(new Event('markers-changed')));
    await expect(panel.getByTestId('whole-plate-banner')).toBeVisible();
    await expect(panel.getByTestId('unassigned-banner')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/qprism-p3-s4-whole-plate.png', fullPage: true });
  });
});
