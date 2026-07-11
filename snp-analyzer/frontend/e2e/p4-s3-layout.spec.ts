import { test, expect } from "@playwright/test";
import { loadExample } from "./helpers/load-example";

/**
 * P4-S3 — Layout save/load/delete (per-user layout library) + "apply
 * previous layout" with confirmation.
 *
 * UX source: docs/multi-marker-ux-decision.md
 *   §3.5   사용자 계정별 레이아웃 라이브러리 (저장/불러오기/삭제, user_id 스코프)
 *   §1 Q3  CSV(교환) + JSON(내부 리치) — UI 기본 버튼 = CSV
 *   §1 Q7  Layout(웰배정+ploidy+type+sample) 기본 / 분석설정(boundaries/threshold)
 *          은 opt-in — 저장된 threshold 무단 재적용 금지
 *   §3     "이전 실행 레이아웃 적용" 제안 — L2: ploidy 무단 승계 금지 (다른 파일
 *          적용 시 재확인 강제), L3: blind apply 금지(사용자 확인 필수)
 *
 * Mockup: docs/mockups/multimarker-mockup.html (#layoutSec, .lyrow, .saveform)
 *
 * feat/library-hub: the full browse/manage UI (list every saved layout,
 * copy/delete, load onto the current plate) moved from this Plate Setup
 * surface into the top-level "라이브러리 / Library" tab's "레이아웃"
 * sub-tab. Plate Setup keeps only the CONTEXTUAL quick actions that operate
 * on THIS session's plate: "현재 배치 저장" (layout-save-open et al.) and
 * "이전 실행 레이아웃 적용" (apply-previous-layout-button + its confirm
 * dialog) -- both unchanged below.
 */
test.describe("P4-S3: Layout save/load/delete", () => {
  test.beforeEach(async ({ page }) => {
    await loadExample(page, 6);
    await page.getByTestId("workspace-tab-plate").click();

    await page.getByTestId("add-marker-button").click();
    await page.getByTestId("marker-name-input").fill("qSwet5.3");
    await page.getByTestId("marker-ploidy-select").selectOption("6");
    await page.getByTestId("marker-form-save").click();

    await page.getByTestId("col-header-1").click();
    await page
      .getByTestId("selection-bar")
      .getByTestId("marker-pick-button")
      .filter({ hasText: "qSwet5.3" })
      .click();
    await page.getByTestId("assign-button").click();
  });

  test("save current layout under a name; it appears in the Library tab's layout list", async ({
    page,
  }) => {
    await page.getByTestId("layout-save-open").click();
    await page.getByTestId("layout-save-name-input").fill("고구마 6배체 테스트");
    await page.getByTestId("layout-save-confirm").click();

    // Browse/manage now lives in the top-level Library tab.
    await page.locator("#tab-library").click();
    await page.getByTestId("library-subtab-layouts").click();

    const row = page.getByTestId("layout-row").filter({ hasText: "고구마 6배체 테스트" });
    await expect(row).toBeVisible();
  });

  test("loading a saved layout (from the Library tab) restores the marker assignment", async ({
    page,
  }) => {
    await page.getByTestId("layout-save-open").click();
    await page.getByTestId("layout-save-name-input").fill("레이아웃 A");
    await page.getByTestId("layout-save-confirm").click();

    // Wipe current assignment to prove `load` actually restores state.
    await page.getByTestId("well-A1").click();
    await page.getByTestId("well-inspector").getByTestId("unassign-button").click();
    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "false");

    await page.locator("#tab-library").click();
    await page.getByTestId("library-subtab-layouts").click();

    const row = page.getByTestId("layout-row").filter({ hasText: "레이아웃 A" });
    await expect(row).toBeVisible();
    await row.getByTestId("layout-load-button").click();

    // Back on the Plate Setup surface, the applied layout's assignment
    // should be visible (PlateSetupTab stays mounted the whole time and
    // refetches its marker set on the Library tab's "markers-changed"
    // announcement, so no reload is needed).
    await page.locator("#tab-analysis").click();
    await page.getByTestId("workspace-tab-plate").click();
    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "true");
  });

  test("deleting a saved layout (from the Library tab) removes it from the list", async ({
    page,
  }) => {
    await page.getByTestId("layout-save-open").click();
    await page.getByTestId("layout-save-name-input").fill("삭제될 레이아웃");
    await page.getByTestId("layout-save-confirm").click();

    await page.locator("#tab-library").click();
    await page.getByTestId("library-subtab-layouts").click();

    const row = page.getByTestId("layout-row").filter({ hasText: "삭제될 레이아웃" });
    await expect(row).toBeVisible();

    await row.getByTestId("layout-delete-button").click();
    await expect(page.getByTestId("layout-row").filter({ hasText: "삭제될 레이아웃" })).toHaveCount(
      0,
    );
  });

  test('"apply previous layout" (Plate Setup quick action) requires explicit confirmation before overwriting', async ({
    page,
  }) => {
    await expect(page.getByTestId("apply-previous-layout-button")).toBeVisible();
    await page.getByTestId("apply-previous-layout-button").click();

    // L3: blind apply is forbidden — a confirmation step is mandatory.
    const dialog = page.getByTestId("apply-previous-layout-confirm-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/확인|적용|덮어씌|overwrite|apply/i);

    await page.getByTestId("apply-previous-layout-cancel").click();
    await expect(dialog).toBeHidden();
    // Canceling must not have touched the current assignment.
    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "true");
  });
});
