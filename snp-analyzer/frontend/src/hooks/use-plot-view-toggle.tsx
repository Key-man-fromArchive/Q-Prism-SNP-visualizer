// @TASK P12-TOGGLE - Results screen large plot area: scatter <-> curve toggle
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
//
// Shared between the single-marker results screen (ResultsPlotToggle.tsx,
// wrapping ScatterPlot) and the multi-marker one (MultiMarkerAnalysisPanel,
// wrapping MarkerScatterPlot) so both offer the same scatter/curve switch
// (FB-12) with one implementation of the toggle state and its buttons.
import { useState } from "react";
import { useI18n } from "./use-i18n";

export type PlotView = "scatter" | "curve";

export function usePlotViewToggle() {
  const { t } = useI18n();
  const [view, setView] = useState<PlotView>("scatter");

  // min-h-11 (44px, Apple/Android's minimum touch target) below the 1280px
  // breakpoint, where the results grid is still a single column and this
  // bar has the full page width to itself; at >=1280px (two columns,
  // sharing the 1440x1000 no-scroll budget with plate+detail --
  // tests/24-responsive.spec.ts:51) it drops to a slim 24px tab height,
  // still comfortably clickable with a mouse, inline with the scatter
  // header row's other icon-sized controls below it.
  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 xl:min-h-6 items-center justify-center rounded px-3 xl:px-2 text-sm xl:text-xs font-medium ${
      active ? "bg-primary text-on-primary" : "text-text hover:bg-surface"
    }`;

  const toggle = (
    <div
      role="group"
      aria-label={t.resultsPlotViewLabel}
      data-testid="results-plot-toggle"
      className="inline-flex gap-1 rounded-md xl:rounded border border-border bg-bg p-0.5 xl:p-px"
    >
      <button
        type="button"
        data-testid="plot-view-scatter"
        aria-pressed={view === "scatter"}
        onClick={() => setView("scatter")}
        className={tabClass(view === "scatter")}
      >
        {t.resultsPlotViewScatter}
      </button>
      <button
        type="button"
        data-testid="plot-view-curve"
        aria-pressed={view === "curve"}
        onClick={() => setView("curve")}
        className={tabClass(view === "curve")}
      >
        {t.resultsPlotViewCurve}
      </button>
    </div>
  );

  return { view, toggle };
}
