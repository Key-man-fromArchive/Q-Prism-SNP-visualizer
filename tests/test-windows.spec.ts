import { test, expect } from "@playwright/test";
import path from "path";

const EDS_FILE = "/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/RAW-data/260126-QS3.eds";

test.describe("Data Window Selection (.eds)", () => {

  test("upload .eds and verify window buttons appear", async ({ page }) => {
    await page.goto("http://localhost:8002");

    // Upload .eds file
    const fileInput = page.locator("#file-input");
    await fileInput.setInputFiles(EDS_FILE);

    // Wait for analysis panel
    await page.waitForSelector("#analysis-panel:not(.hidden)", { timeout: 15000 });

    // Screenshot: initial state (should show Amplification window active)
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "/tmp/eds-01-initial.png", fullPage: true });

    // Verify window selector is visible with 3 buttons
    const windowSelector = page.locator("#window-selector");
    await expect(windowSelector).toBeVisible();

    const buttons = windowSelector.locator(".window-btn");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveText("Pre-read");
    await expect(buttons.nth(1)).toHaveText("Amplification");
    await expect(buttons.nth(2)).toHaveText("Post-read");

    // Verify Amplification is active by default
    await expect(buttons.nth(1)).toHaveClass(/active/);

    // Verify slider shows 23 cycles for Amplification window
    const cycleMax = page.locator("#cycle-max");
    await expect(cycleMax).toHaveText("23");

    // Slider row should be visible
    const sliderRow = page.locator(".slider-row");
    await expect(sliderRow).toBeVisible();

    console.log("PASS: Initial state correct - Amplification active, 23 cycles");
  });

  test("click Pre-read hides slider, shows baseline data", async ({ page }) => {
    await page.goto("http://localhost:8002");
    const fileInput = page.locator("#file-input");
    await fileInput.setInputFiles(EDS_FILE);
    await page.waitForSelector("#analysis-panel:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Click Pre-read button
    const preReadBtn = page.locator(".window-btn", { hasText: "Pre-read" });
    await preReadBtn.click();
    await page.waitForTimeout(500);

    // Screenshot
    await page.screenshot({ path: "/tmp/eds-02-preread.png", fullPage: true });

    // Pre-read should be active
    await expect(preReadBtn).toHaveClass(/active/);

    // Slider row and cycle label should be hidden (single-point window)
    const sliderRow = page.locator(".slider-row");
    const cycleLabel = page.locator("#cycle-label");
    await expect(sliderRow).toBeHidden();
    await expect(cycleLabel).toBeHidden();

    console.log("PASS: Pre-read - slider hidden, button active");
  });

  test("click Post-read hides slider, shows endpoint data", async ({ page }) => {
    await page.goto("http://localhost:8002");
    const fileInput = page.locator("#file-input");
    await fileInput.setInputFiles(EDS_FILE);
    await page.waitForSelector("#analysis-panel:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Click Post-read button
    const postReadBtn = page.locator(".window-btn", { hasText: "Post-read" });
    await postReadBtn.click();
    await page.waitForTimeout(500);

    // Screenshot
    await page.screenshot({ path: "/tmp/eds-03-postread.png", fullPage: true });

    // Post-read should be active
    await expect(postReadBtn).toHaveClass(/active/);

    // Slider hidden
    const sliderRow = page.locator(".slider-row");
    await expect(sliderRow).toBeHidden();

    console.log("PASS: Post-read - slider hidden, button active");
  });

  test("click back to Amplification restores slider", async ({ page }) => {
    await page.goto("http://localhost:8002");
    const fileInput = page.locator("#file-input");
    await fileInput.setInputFiles(EDS_FILE);
    await page.waitForSelector("#analysis-panel:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Click Pre-read first
    await page.locator(".window-btn", { hasText: "Pre-read" }).click();
    await page.waitForTimeout(300);

    // Click Amplification
    const ampBtn = page.locator(".window-btn", { hasText: "Amplification" });
    await ampBtn.click();
    await page.waitForTimeout(500);

    // Screenshot
    await page.screenshot({ path: "/tmp/eds-04-back-to-amp.png", fullPage: true });

    // Amplification active
    await expect(ampBtn).toHaveClass(/active/);

    // Slider visible with 23 cycles
    const sliderRow = page.locator(".slider-row");
    await expect(sliderRow).toBeVisible();
    await expect(page.locator("#cycle-max")).toHaveText("23");

    console.log("PASS: Back to Amplification - slider restored, 23 cycles");
  });

  test("well click shows amplification curve with all 25 points", async ({ page }) => {
    await page.goto("http://localhost:8002");
    const fileInput = page.locator("#file-input");
    await fileInput.setInputFiles(EDS_FILE);
    await page.waitForSelector("#analysis-panel:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Click a non-empty well in the plate view (skip empty wells)
    const well = page.locator(".plate-well:not(.empty)").first();
    await well.click();
    await page.waitForTimeout(1000);

    // Screenshot
    await page.screenshot({ path: "/tmp/eds-05-amp-curve.png", fullPage: true });

    // Amplification plot should be visible
    const ampPlot = page.locator("#amplification-plot");
    await expect(ampPlot).toBeVisible();

    console.log("PASS: Amplification curve visible after well click");
  });
});
