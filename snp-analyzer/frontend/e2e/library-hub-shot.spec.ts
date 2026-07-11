import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadExample } from "./helpers/load-example";
import { defineMarkersOnColumns } from "./helpers/define-markers";

/**
 * Screenshot-only spec (no new assertions beyond "the element we're about to
 * shoot is visible") — captures the new top-level "라이브러리 / Library" tab
 * (feat/library-hub: consolidates the standalone Marker Catalog tab and the
 * Plate Setup surface's layout-library panel into one tab with two
 * sub-tabs: `library-subtab-catalog` / `library-subtab-layouts`).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(__dirname, "shots");

test.use({ viewport: { width: 1440, height: 1000 } });

test("09 — Library tab: 마커 카탈로그 sub-tab with an entry", async ({ page }) => {
  await loadExample(page, 6);

  await page.locator("#tab-library").click();
  await expect(page.getByTestId("library-subtab-catalog")).toBeVisible();
  await page.getByTestId("library-subtab-catalog").click();
  await expect(page.getByTestId("library-panel-catalog")).toBeVisible();

  const panel = page.getByTestId("marker-catalog-tab");
  await expect(panel).toBeVisible();

  await page.getByTestId("catalog-add-button").click();
  const form = page.getByTestId("catalog-form");
  await expect(form).toBeVisible();
  await page.getByTestId("catalog-name-input").fill("qSwet5.3 (library hub)");
  await page.getByTestId("catalog-form-save").click();
  await expect(form).toBeHidden();

  const row = page.getByTestId("catalog-entry-row").filter({ hasText: "qSwet5.3 (library hub)" });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle");

  await page.screenshot({
    path: path.join(shotsDir, "09-library-hub.png"),
    fullPage: true,
  });
});

test("10 — Library tab: 레이아웃 sub-tab with a saved layout", async ({ page }) => {
  await loadExample(page, 6);
  await defineMarkersOnColumns(page, ["qSwet5.3"], 6);

  await page.getByTestId("workspace-tab-plate").click();
  await page.getByTestId("layout-save-open").click();
  await page.getByTestId("layout-save-name-input").fill("라이브러리 허브 레이아웃");
  await page.getByTestId("layout-save-confirm").click();

  await page.locator("#tab-library").click();
  await page.getByTestId("library-subtab-layouts").click();
  await expect(page.getByTestId("library-panel-layouts")).toBeVisible();

  const row = page.getByTestId("layout-row").filter({ hasText: "라이브러리 허브 레이아웃" });
  await expect(row).toBeVisible();
  // A session is open, so the row's "load onto current plate" action and the
  // panel's own "현재 배치 저장" convenience should both be present.
  await expect(row.getByTestId("layout-load-button")).toBeVisible();
  await expect(page.getByTestId("library-layout-save-open")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.screenshot({
    path: path.join(shotsDir, "10-library-layouts.png"),
    fullPage: true,
  });
});
