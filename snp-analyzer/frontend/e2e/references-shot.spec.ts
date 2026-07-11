import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Screenshot-only spec (no product-code changes) — captures the new
 * References tab (`src/components/references/ReferencesTab.tsx`,
 * `data-testid="references-tab"`) so an orchestrator can visually verify it
 * without running the app.
 *
 * The tab is `sessionFree` (see TabNavigation.tsx), so it's reachable right
 * after login with no example dataset load needed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(__dirname, "shots");

test.use({ viewport: { width: 1440, height: 900 } });

test("06/07 — References tab renders citations + scope note", async ({ page }) => {
  await page.goto("/");

  // With no active session, TabNavigation itself only mounts once activeTab
  // is one of the session-free tabs (project/users/references) — see
  // App.tsx's `showProjectOnly` gate. UploadZone's "기존 세션 및 프로젝트
  // 관리 →" link (onGoToProject) flips activeTab to "project" first, which
  // reveals the nav bar; the References tab is then just a click away
  // (sessionFree, so never disabled regardless of session state).
  const goToProjectsLink = page.locator("main button", { hasText: /프로젝트 관리|projects/i });
  await expect(goToProjectsLink).toBeVisible({ timeout: 15_000 });
  await goToProjectsLink.click();

  const tabButton = page.locator("#tab-references");
  await expect(tabButton).toBeVisible({ timeout: 15_000 });
  await expect(tabButton).toBeEnabled({ timeout: 15_000 });
  await tabButton.click();

  const panel = page.getByTestId("references-tab");
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await page.waitForLoadState("networkidle");

  // Viewport-clipped shot (1440x900, set via test.use above).
  await page.screenshot({
    path: path.join(shotsDir, "06-references-tab.png"),
  });

  // The content is taller than one 1440x900 viewport (6 citation groups +
  // scope note), so also capture the full scrollable page.
  await page.screenshot({
    path: path.join(shotsDir, "07-references-tab-full.png"),
    fullPage: true,
  });
});
