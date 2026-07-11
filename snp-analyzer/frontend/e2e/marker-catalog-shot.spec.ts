import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Screenshot-only spec (no product-code changes) — captures the new Marker
 * Catalog tab (`src/components/catalog/MarkerCatalogTab.tsx`,
 * `data-testid="marker-catalog-tab"`) so an orchestrator can visually verify
 * it without running the app.
 *
 * The tab is `sessionFree` (see TabNavigation.tsx), so it's reachable right
 * after login with no example dataset load needed. Creates one catalog
 * assay with validation="validated" + amplification_verified=true (both
 * halves of the derived dosage_trust rule -- app.models.
 * MarkerCatalogEntry.dosage_trust) so the "validated" (green) badge is
 * visible in the shot alongside the form's live preview badge.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(__dirname, "shots");

test.use({ viewport: { width: 1440, height: 1100 } });

test("08 — Marker Catalog tab: create a validated assay", async ({ page }) => {
  await page.goto("/");

  // With no active session, TabNavigation itself only mounts once activeTab
  // is one of the session-free tabs (project/users/references/catalog) --
  // see App.tsx's `showProjectOnly` gate. UploadZone's "기존 세션 및 프로젝트
  // 관리 →" link (onGoToProject) flips activeTab to "project" first, which
  // reveals the nav bar; the Marker Catalog tab is then just a click away
  // (sessionFree, so never disabled regardless of session state).
  const goToProjectsLink = page.locator("main button", { hasText: /프로젝트 관리|projects/i });
  await expect(goToProjectsLink).toBeVisible({ timeout: 15_000 });
  await goToProjectsLink.click();

  const tabButton = page.locator("#tab-catalog");
  await expect(tabButton).toBeVisible({ timeout: 15_000 });
  await expect(tabButton).toBeEnabled({ timeout: 15_000 });
  await tabButton.click();

  const panel = page.getByTestId("marker-catalog-tab");
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create one catalog entry, filling in enough detail + calibration/
  // validation evidence to reach dosage_trust="validated".
  await page.getByTestId("catalog-add-button").click();
  const form = page.getByTestId("catalog-form");
  await expect(form).toBeVisible();

  await page.getByTestId("catalog-name-input").fill("qSwet5.3");
  await page.getByTestId("catalog-controls-present-checkbox").check();
  await page.getByTestId("catalog-amplification-verified-checkbox").check();
  await page.getByTestId("catalog-validation-status-select").selectOption("validated");
  await page.getByTestId("catalog-concordance-input").fill("0.98");

  // Live preview badge inside the form should already read "validated".
  await expect(form.getByTestId("catalog-dosage-trust-badge")).toHaveAttribute(
    "data-trust",
    "validated"
  );

  await page.getByTestId("catalog-form-save").click();
  await expect(form).toBeHidden();

  const row = page.getByTestId("catalog-entry-row").filter({ hasText: "qSwet5.3" });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByTestId("catalog-dosage-trust-badge")).toHaveAttribute(
    "data-trust",
    "validated"
  );

  await page.waitForLoadState("networkidle");

  await page.screenshot({
    path: path.join(shotsDir, "08-marker-catalog.png"),
    fullPage: true,
  });
});
