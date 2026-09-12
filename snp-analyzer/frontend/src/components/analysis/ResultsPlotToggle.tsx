// @TASK P12-TOGGLE - Results screen large plot area: scatter <-> curve toggle
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
// @TEST src/components/analysis/ResultsPlotToggle.test.tsx
//
// FB-12: the scatter plot and the amplification curve used to compete for
// space (scatter always visible, curve squeezed into a 135px strip inside
// .detail-panel -- P11-VIEWPORT-BUDGET). The user does not need both at
// once, so this switches the SAME large plot area between them instead.
// The multi-marker results screen gets the same switch from
// MultiMarkerAnalysisPanel.tsx, sharing this toggle's state/buttons via
// use-plot-view-toggle.tsx rather than duplicating them.
//
// Both ScatterPlot and AmplificationCurvePanel stay mounted at all times,
// toggled with an inline `display: none` (same convention as PlateView's
// scroll region) rather than conditionally rendered:
//   - #scatter-plot must exist in the DOM in the default (scatter) state
//     for tests/24-responsive.spec.ts:51's viewport-budget check.
//   - Unmounting/remounting ScatterPlot on every toggle would re-fetch
//     scatter data and rebuild its Plotly instance (losing pan/zoom) purely
//     because the operator looked at the curve for a moment.
//   - AmplificationCurvePanel already fetches independently of `active`
//     (see its doc comment), so it shows the current well immediately when
//     switched to, with no fetch delay.
//
// The toggle BUTTONS themselves are threaded into whichever of the two is
// currently active (`viewToggle` prop, rendered as that component's own
// slim row -- see ScatterPlot.tsx's comment on why this is its own row
// rather than folded into ScatterViewControls' already-full header). Only
// the active one receives the node, so exactly one copy of the toggle ever
// exists in the DOM -- passing it to both unconditionally would render it
// twice (one hidden by the parent's `display: none`, one not), breaking
// every `getByTestId('plot-view-...')` lookup with a duplicate match.
import { usePlotViewToggle } from "@/hooks/use-plot-view-toggle";
import { ScatterPlot } from "./ScatterPlot";
import { AmplificationCurvePanel } from "./AmplificationCurvePanel";

export function ResultsPlotToggle() {
  const { view, toggle } = usePlotViewToggle();

  return (
    <div className="results-plot-panel" data-testid="results-plot-panel">
      <div style={{ display: view === "scatter" ? undefined : "none" }}>
        <ScatterPlot active={view === "scatter"} viewToggle={view === "scatter" ? toggle : undefined} />
      </div>
      <div style={{ display: view === "curve" ? undefined : "none" }}>
        <AmplificationCurvePanel active={view === "curve"} viewToggle={view === "curve" ? toggle : undefined} />
      </div>
    </div>
  );
}
