import { test, expect } from "@playwright/test";
import { loadExample } from "./helpers/load-example";

/**
 * P4-S0 — Upload/Load-example lands on a fully-analysed single-marker view
 * by default (zero friction for the common single-marker case), with a
 * non-blocking affordance to split the plate into multiple markers.
 *
 * UX source: docs/multi-marker-ux-decision.md
 *   §0  "업로드 시: 현행처럼 전체를 단일 마커로 자동 분석 → 바로 Analysis에 결과 표시
 *        (단일마커 사용자 마찰 0)"
 *   §1 Q1  "비차단(opt-in). 업로드 시 전체=단일마커 자동 분석, '마커로 분할?' 배너로 유도"
 *
 * This is the RED-first contract for the P4 implementation: today's UI has
 * no `single-marker-analysis-view` wrapper and no split-marker banner, so
 * every test below is expected to fail until P4 lands.
 */
test.describe("P4-S0: single-marker default + split affordance", () => {
  test("loading an example auto-analyses the whole plate as one marker", async ({ page }) => {
    await loadExample(page, 2);

    // The existing single-marker analysis (scatter + results table) renders
    // immediately, wrapped in a stable container the P4 implementation adds
    // around the current AnalysisTab content.
    await expect(page.getByTestId("single-marker-analysis-view")).toBeVisible();
  });

  test('shows a non-blocking "split into markers?" banner, dismissible', async ({ page }) => {
    await loadExample(page, 2);

    const banner = page.getByTestId("split-marker-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/마커로 분할|split into markers/i);

    // Non-blocking: the single-marker result underneath stays visible/usable
    // while the banner is shown (no modal, no gate).
    await expect(page.getByTestId("single-marker-analysis-view")).toBeVisible();

    await page.getByTestId("split-marker-dismiss").click();
    await expect(banner).toBeHidden();
  });

  test("banner CTA navigates to the Plate Setup surface", async ({ page }) => {
    await loadExample(page, 2);

    await page.getByTestId("split-marker-cta").click();
    await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-plate")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
