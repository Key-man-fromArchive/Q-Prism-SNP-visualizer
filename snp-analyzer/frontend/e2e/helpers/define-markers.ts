import { expect, type Page } from "@playwright/test";

/**
 * Test-only convenience: switches to Plate Setup, creates each named marker
 * (given ploidy) and paints it onto two whole plate columns via the
 * column-header selection ergonomic, then applies (배정).
 *
 * This mirrors the §3.5 "웰 선택 → 마커 선택 → 배정" flow and the §3 "열
 * 기반 분할" pattern, using only the data-testid contract documented in
 * README-e2e.md — it does not assume any implementation detail beyond that
 * contract.
 */
export async function defineMarkersOnColumns(
  page: Page,
  names: string[],
  ploidy: number = 6,
): Promise<void> {
  await page.getByTestId("workspace-tab-plate").click();
  await expect(page.getByTestId("workspace-panel-plate")).toBeVisible();

  let col = 1;
  for (const name of names) {
    await page.getByTestId("add-marker-button").click();
    await page.getByTestId("marker-name-input").fill(name);
    await page.getByTestId("marker-ploidy-select").selectOption(String(ploidy));
    await page.getByTestId("marker-form-save").click();

    await page.getByTestId(`col-header-${col}`).click();
    await page.getByTestId(`col-header-${col + 1}`).click();

    await page
      .getByTestId("selection-bar")
      .getByTestId("marker-pick-button")
      .filter({ hasText: name })
      .click();
    await page.getByTestId("assign-button").click();

    col += 2;
  }
}
