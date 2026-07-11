import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadExample } from "./helpers/load-example";
import { defineMarkersOnColumns } from "./helpers/define-markers";

/**
 * Screenshot-only spec (no new assertions beyond "the element we're about to
 * shoot is visible") — captures full-page PNGs of the multi-marker P4 UI so
 * an orchestrator can visually verify it without running the app itself.
 *
 * Does NOT modify any product code; reuses the existing e2e helpers
 * (loadExample / defineMarkersOnColumns) and the existing data-testid
 * contract documented in README-e2e.md.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(__dirname, "shots");

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("Screenshots: multi-marker UI", () => {
  test("01 — single-marker default analysis view + split banner", async ({ page }) => {
    await loadExample(page, 6);

    await expect(page.getByTestId("single-marker-analysis-view")).toBeVisible();
    await expect(page.getByTestId("split-marker-banner")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(shotsDir, "01-analysis-default.png"),
      fullPage: true,
    });
  });

  test("02 — plate setup with two markers defined", async ({ page }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3", "qTotal11.1"], 6);

    // defineMarkersOnColumns leaves us on the Plate Setup tab already, but
    // be explicit for a stable, repeatable shot.
    await page.getByTestId("workspace-tab-plate").click();
    await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();
    await expect(page.getByTestId("marker-card").filter({ hasText: "qSwet5.3" })).toBeVisible();
    await expect(page.getByTestId("marker-card").filter({ hasText: "qTotal11.1" })).toBeVisible();
    // defineMarkersOnColumns paints 2 whole columns per marker, back to
    // back: marker 1 -> cols 1-2, marker 2 -> cols 3-4, cols 5+ unassigned.
    await expect(page.getByTestId("well-A1")).toHaveAttribute("data-assigned", "true");
    await expect(page.getByTestId("well-A3")).toHaveAttribute("data-assigned", "true");
    await expect(page.getByTestId("well-A5")).toHaveAttribute("data-assigned", "false");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(shotsDir, "02-plate-setup-two-markers.png"),
      fullPage: true,
    });
  });

  test("03 — per-marker analysis results", async ({ page }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3", "qTotal11.1"], 6);

    await page.getByTestId("workspace-tab-analysis").click();
    const selector = page.getByTestId("marker-selector-dropdown");
    await expect(selector).toBeVisible();
    await selector.selectOption({ label: "qSwet5.3" });

    await expect(page.getByTestId("marker-scatter")).toBeVisible();
    await expect(page.getByTestId("genotype-counts")).toBeVisible();
    await expect(page.getByTestId("marker-ploidy-badge")).toContainText("6배체");
    await expect(page.getByTestId("marker-expected-classes")).toBeVisible();
    await expect(page.getByTestId("marker-observed-classes")).toBeVisible();
    await expect(page.getByTestId("marker-ntc-note")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(shotsDir, "03-analysis-per-marker.png"),
      fullPage: true,
    });
  });

  test("04 — marker selector state (dropdown, 2 markers)", async ({ page }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3", "qTotal11.1"], 6);

    await page.getByTestId("workspace-tab-analysis").click();
    const selector = page.getByTestId("marker-selector-dropdown");
    await expect(selector).toBeVisible();
    // Only 2 markers -> dropdown mode, no sidebar (per Q8 count-based swap).
    await expect(page.getByTestId("marker-selector-sidebar")).toHaveCount(0);

    // Let clustering/scatter finish first so the shot doesn't catch a
    // transient "분석 중..." loading state behind the selector.
    await expect(page.getByTestId("marker-scatter")).toBeVisible();

    await selector.focus();
    // Native <select> popups are OS-rendered and not part of the page's
    // screenshot surface in headless Chromium; focusing it clearly shows
    // the selector state (focus ring) with both marker options loaded.
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(shotsDir, "04-marker-selector.png"),
      fullPage: true,
    });
  });

  test("05 — layout library (Library tab) after saving a layout", async ({ page }) => {
    await loadExample(page, 6);
    await defineMarkersOnColumns(page, ["qSwet5.3", "qTotal11.1"], 6);

    await page.getByTestId("workspace-tab-plate").click();
    await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();

    // "현재 배치 저장" is a contextual quick action that stays on Plate Setup
    // (feat/library-hub); the saved layout's browse/manage list itself now
    // lives in the top-level Library tab's "레이아웃" sub-tab.
    await page.getByTestId("layout-save-open").click();
    await page.getByTestId("layout-save-name-input").fill("스크린샷 레이아웃");
    await page.getByTestId("layout-save-confirm").click();

    await page.locator("#tab-library").click();
    await page.getByTestId("library-subtab-layouts").click();

    const row = page.getByTestId("layout-row").filter({ hasText: "스크린샷 레이아웃" });
    await expect(row).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(shotsDir, "05-layout-library.png"),
      fullPage: true,
    });
  });
});
