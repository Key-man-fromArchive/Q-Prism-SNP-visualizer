import { test, expect } from "@playwright/test";
import { loadExample } from "./helpers/load-example";
import { defineMarkersOnColumns } from "./helpers/define-markers";

/**
 * P4-S2 — Analysis surface (`분석` tab), per-marker results.
 *
 * UX source: docs/multi-marker-ux-decision.md
 *   §1 Q8   개수별 컴포넌트 스왑: ≤3 마커 = 드롭다운, 4+ 마커 = 좌측 사이드바
 *           (이름·ploidy·n·genotype 요약·경고 아이콘)
 *   §3      ploidy가 최고위험 필드 → 마커별 눈에 띄는 선택기, 기대 클러스터 수
 *           표시, 관측≠기대 시 경고
 *   §1 Q5   배경차감 = 마커별 재계산 (마커별 독립 산점도/결과가 그 증거)
 *
 * Mockup: docs/mockups/multimarker-mockup.html (#analysisList, #scatter,
 * #counts, #anPloidy, #anExpect)
 *
 * RED-first: these testids do not exist yet.
 */
test.describe("P4-S2: Analysis tab — per-marker results", () => {
  test("<=3 markers: dropdown selector; scatter/counts/ploidy switch per marker", async ({
    page,
  }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3", "qTotal11.1"], 6);

    await page.getByTestId("workspace-tab-analysis").click();
    const selector = page.getByTestId("marker-selector-dropdown");
    await expect(selector).toBeVisible();
    await expect(page.getByTestId("marker-selector-sidebar")).toHaveCount(0);

    await selector.selectOption({ label: "qSwet5.3" });
    await expect(page.getByTestId("marker-scatter")).toBeVisible();
    await expect(page.getByTestId("genotype-counts")).toBeVisible();
    await expect(page.getByTestId("marker-ploidy-badge")).toContainText("6배체");
    await expect(page.getByTestId("marker-expected-classes")).toContainText("7");

    // Switching markers re-renders scatter/counts for the newly selected one.
    await selector.selectOption({ label: "qTotal11.1" });
    await expect(page.getByTestId("marker-scatter")).toBeVisible();
    await expect(page.getByTestId("marker-ploidy-badge")).toContainText("6배체");
  });

  test("4+ markers: sidebar of marker cards replaces the dropdown", async ({ page }) => {
    await loadExample(page, 2);
    await defineMarkersOnColumns(page, ["m1", "m2", "m3", "m4"], 2);

    await page.getByTestId("workspace-tab-analysis").click();
    await expect(page.getByTestId("marker-selector-sidebar")).toBeVisible();
    await expect(page.getByTestId("marker-selector-dropdown")).toHaveCount(0);

    const cards = page.getByTestId("marker-sidebar-card");
    await expect(cards).toHaveCount(4);

    await cards.filter({ hasText: "m3" }).click();
    await expect(page.getByTestId("marker-scatter")).toBeVisible();
  });

  test("per-marker NTC/background note reflects marker-local computation (Q4/Q5)", async ({
    page,
  }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3", "qTotal11.1"], 6);

    await page.getByTestId("workspace-tab-analysis").click();
    await page.getByTestId("marker-selector-dropdown").selectOption({ label: "qSwet5.3" });

    // Must not claim a plate-global NTC/background — each marker computes
    // its own (see C4/C7/Q4/Q5): "플레이트 전역으로 공유하지 않습니다".
    await expect(page.getByTestId("marker-ntc-note")).toContainText(
      /전역.*(공유하지 않|아님)|not shared (plate-wide|globally)/i,
    );
  });

  test("expected-vs-observed dosage class badges are both present (ploidy risk field)", async ({
    page,
  }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3"], 6);
    await page.getByTestId("workspace-tab-analysis").click();

    await expect(page.getByTestId("marker-ploidy-badge")).toBeVisible();
    await expect(page.getByTestId("marker-expected-classes")).toBeVisible();
    await expect(page.getByTestId("marker-observed-classes")).toBeVisible();
  });
});
