import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, ".auth", "user.json");

// Override with your own local-mode test user. See README-e2e.md "Auth modes"
// for why the backend MUST be running with SNP_AUTH_MODE=local for this to
// work (SNP_AUTH_MODE=asg_launch disables POST /api/auth/login entirely).
const E2E_USERNAME = process.env.E2E_USERNAME || "e2e_admin";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "E2eTestPass123!";

/**
 * "Setup project" pattern (Playwright's recommended way to reuse auth):
 * logs in once via the real LoginPage UI, then persists the resulting
 * session cookie + localStorage to e2e/.auth/user.json. Every spec project
 * depends on this one and reuses that storageState, so individual specs
 * never need to touch the login form.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/");

  const usernameInput = page.locator("#username");

  // If the backend is running in `asg_launch` auth mode, the local
  // username/password form never renders LoginPage's inputs the same way
  // an already-linked ASG session would bypass login, OR (more commonly)
  // POST /api/auth/login returns 404 ("Local login is disabled") once
  // submitted below. Either failure mode surfaces here with a clear
  // Playwright timeout/assertion error — see README-e2e.md "Auth modes"
  // for how to point this harness at a SNP_AUTH_MODE=local backend.
  await expect(usernameInput).toBeVisible({ timeout: 15_000 });
  await usernameInput.fill(E2E_USERNAME);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^(sign in|로그인)$/i }).click();

  // Successful login swaps LoginPage for the app shell: either the upload
  // zone (no session yet) or the tab navigation (existing session).
  await expect(
    page.locator("#upload-zone, #tab-analysis").first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
