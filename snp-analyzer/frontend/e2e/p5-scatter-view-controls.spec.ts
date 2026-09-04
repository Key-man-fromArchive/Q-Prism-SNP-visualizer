// Controls that must sit next to the scatter plot, not in the Settings tab.
//
// Driven by a real run (1-2_admin_2026-09-03 16-14-11_783BR20183.pcrd) where
// each of these was missing or unreachable:
//  - no axis min/max anywhere near the plot, and a plain autorange put (0, 0)
//    off-canvas, so the middle of the data cloud read as the origin
//  - the NTC quadrant corner could only be moved by dragging a marker that
//    itself sits inside the data cloud
//  - the ROX toggle lived in the Settings tab and the axis titles claimed
//    normalization whether or not any had happened
//  - a drag near the NTC corner or a boundary ray was swallowed before Plotly
//    saw it, so box-selection often could not be started
import { expect, test } from "@playwright/test";
import { loadExample } from "./helpers/load-example";

test.beforeEach(async ({ page }) => {
  await loadExample(page, 2);
  await expect(page.getByTestId("scatter-view-controls")).toBeVisible({ timeout: 20_000 });
});

test("axes default to zero-anchored with a locked aspect", async ({ page }) => {
  // The drawn origin has to BE the origin: every genotype call is an angle
  // about the ratio origin, and a tight autorange hides where that is.
  await expect(page.getByTestId("axis-mode")).toHaveValue("zero");
  await expect(page.getByTestId("axis-lock-aspect")).toBeChecked();
});

test("manual mode exposes editable x/y bounds, and fit-to-data fills them", async ({ page }) => {
  const xMin = page.getByTestId("axis-x-min");
  const xMax = page.getByTestId("axis-x-max");
  const yMax = page.getByTestId("axis-y-max");

  // Disabled until the operator asks for manual bounds, so the placeholder
  // 0..12 range can never silently crop a raw-RFU plate.
  await expect(xMin).toBeDisabled();

  await page.getByTestId("axis-mode").selectOption("manual");
  await expect(xMin).toBeEnabled();
  await expect(page.getByTestId("axis-lock-aspect")).toBeDisabled();

  await page.getByTestId("axis-fit-to-data").click();
  const fittedXMax = Number(await xMax.inputValue());
  const fittedYMax = Number(await yMax.inputValue());
  expect(fittedXMax).toBeGreaterThan(0);
  expect(fittedYMax).toBeGreaterThan(0);

  await xMax.fill(String(fittedXMax * 2));
  await expect(xMax).toHaveValue(String(fittedXMax * 2));
});

test("the NTC quadrant is settable by number and resettable to auto", async ({ page }) => {
  const famMax = page.getByTestId("ntc-fam-max");
  const reset = page.getByTestId("ntc-quadrant-reset");

  // Inferred to begin with, so there is nothing to reset yet.
  await expect(reset).toBeDisabled();

  const inferred = Number(await famMax.inputValue());
  await famMax.fill(String(inferred * 1.5));
  await famMax.blur();

  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
});

test("a drag selects wells by default and edits thresholds only on request", async ({ page }) => {
  // The two used to be armed at once and the edit handlers won, which is why
  // selection could not be started on top of a threshold.
  await expect(page.getByTestId("scatter-tool-select")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scatter-tool-edit")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("scatter-tool-edit").click();
  await expect(page.getByTestId("scatter-tool-edit")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("scatter-tool-select")).toHaveAttribute("aria-pressed", "false");
});

test("the plot states whether the values were normalized, not what was asked", async ({ page }) => {
  const badge = page.getByTestId("normalization-state");
  await expect(badge).toBeVisible();
  const applied = await badge.getAttribute("data-applied");
  expect(applied === "true" || applied === "false").toBe(true);

  // Turning the request off must be reflected in the badge, since the axis
  // titles follow the badge rather than the checkbox.
  const toggle = page.getByTestId("scatter-use-rox");
  if (await toggle.isChecked()) {
    await toggle.uncheck();
    await expect(badge).toHaveAttribute("data-applied", "false", { timeout: 20_000 });
  }
});

test("the plot names where its ratio origin came from", async ({ page }) => {
  // A fallback estimate is a much weaker claim than the plate's own NTC wells,
  // and the operator can replace it by marking them — so it has to say which
  // one is in force.
  await expect(page.getByTestId("ratio-origin-note")).toContainText(/.+/);
});

test("box-selecting the scatter selects wells", async ({ page }) => {
  // The regression this guards: in select mode NO drag handler of ours is
  // installed, so Plotly receives the mousedown wherever it lands -- including
  // on top of the NTC corner marker and the boundary rays, which sit inside
  // the data cloud and used to swallow the drag before Plotly saw it.
  const plot = page.locator("#scatter-plot");
  // Centred, not merely scrolled into view: the analysis toolbar is
  // `sticky top-0`, so a minimally-scrolled plot has its top edge underneath
  // it and a drag started there lands on the toolbar instead.
  await page.evaluate(() => {
    document.querySelector("#scatter-plot")?.scrollIntoView({ block: "center" });
  });
  const dragLayer = plot.locator(".nsewdrag").first();
  await expect(dragLayer).toBeVisible({ timeout: 20_000 });

  const box = await dragLayer.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.85, { steps: 20 });
  await page.mouse.up();

  await expect(page.getByTestId("analysis-selection-count")).not.toContainText(/^0/, {
    timeout: 15_000,
  });
});
