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
  await page.getByTestId("workspace-tab-plate").click();
  await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();
}

test.describe("P4-S1: Plate Setup tab", () => {
  test.beforeEach(async ({ page }) => {
    // Hexaploid example: matches the decision-doc's worked qSwet5.3/qTotal11.1
    // examples (6배체 → up to 7 dosage classes).
    await loadExample(page, 6);
    await goToPlateSetup(page);
  });

  test("two-surface tabs exist: 플레이트 설정 / 분석, freely switchable", async ({ page }) => {
    await expect(page.getByTestId("workspace-tab-plate")).toContainText("플레이트 설정");
    await expect(page.getByTestId("workspace-tab-analysis")).toContainText("분석");

    await page.getByTestId("workspace-tab-analysis").click();
    await expect(page.getByTestId("workspace-panel-analysis")).toBeVisible();

    // Free round-trip, not a one-way wizard step.
    await page.getByTestId("workspace-tab-plate").click();
    await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();
  });

  test("unassigned wells render gray (data-assigned=false) by default", async ({ page }) => {
    const well = page.getByTestId("well-A1");
    await expect(well).toBeVisible();
    await expect(well).toHaveAttribute("data-assigned", "false");
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

  test("unassigned-wells banner counts remaining unassigned wells (warn, not block)", async ({
    page,
  }) => {
    const banner = page.getByTestId("unassigned-banner");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("unassigned-count")).toContainText(/\d+/);

    // Analysis tab must remain reachable — unassigned wells never block work.
    await page.getByTestId("workspace-tab-analysis").click();
    await expect(page.getByTestId("workspace-panel-analysis")).toBeVisible();
  });
});
