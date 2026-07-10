import { expect, type Page } from "@playwright/test";

export type ExamplePloidy = 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Loads one of the built-in synthetic example datasets (2x-8x ploidy) via
 * UploadZone's "Load example" dropdown (`#example-select`, see
 * src/components/upload/UploadZone.tsx) and waits for the resulting session
 * to land on the tabbed workspace.
 *
 * Using the example datasets means every spec is self-contained: no .pcrd
 * decryption key, no real instrument file, no fixtures to maintain.
 *
 * Requires the caller's Playwright project to already be authenticated
 * (see e2e/auth.setup.ts + the `storageState` wiring in playwright.config.ts).
 */
export async function loadExample(page: Page, ploidy: ExamplePloidy = 2): Promise<void> {
  await page.goto("/");

  const exampleSelect = page.locator("#example-select");
  await expect(exampleSelect).toBeVisible({ timeout: 15_000 });
  await exampleSelect.selectOption(String(ploidy));

  // Loading an example creates a session; the app swaps UploadZone for the
  // tabbed workspace (#analysis-panel), landing on the "analysis" tab by
  // default (see src/App.tsx `activeTab` initial state).
  await expect(page.locator("#tab-analysis")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#tab-analysis")).toBeEnabled({ timeout: 20_000 });
}
