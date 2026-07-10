import { defineConfig, devices } from "@playwright/test";

/**
 * Q-Prism multi-marker (Phase 4) E2E harness.
 *
 * See README-e2e.md for:
 *  - how to point this at a running backend (VITE_DEV_API_TARGET / E2E_BASE_URL)
 *  - auth requirements (backend must run with SNP_AUTH_MODE=local)
 *  - the full data-testid contract these specs assume the P4 UI will implement
 *
 * These specs are written RED-first: they encode the agreed UX
 * (docs/multi-marker-ux-decision.md + docs/mockups/multimarker-mockup.html)
 * before the multi-marker frontend exists, so they are EXPECTED to fail
 * against today's UI.
 */

const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 5174;
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const backendTarget = process.env.VITE_DEV_API_TARGET || "http://localhost:8002";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Runs first (Playwright's documented "setup project" pattern): logs in
    // via the UI and persists cookies/localStorage to e2e/.auth/user.json,
    // which every other project reuses via `storageState` below.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  // Starts the Vite dev server (proxying /api -> backendTarget) before the
  // "setup" project (and therefore before any test) runs.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_DEV_API_TARGET: backendTarget,
    },
  },
});
