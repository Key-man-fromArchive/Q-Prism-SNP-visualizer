// @TASK P12-TOGGLE - Amplification curve view (results screen large plot area)
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
// @TEST src/components/analysis/AmplificationCurvePanel.test.tsx
//
// Extracted out of WellDetailPanel (P8-E2E-DEBT / P11-VIEWPORT-BUDGET): the
// curve used to be squeezed into a 135px strip at the bottom of the compact
// well-detail sidebar. It now shares the results screen's large plot area
// with ScatterPlot, one view at a time (ResultsPlotToggle), instead of both
// plots competing for the same small space.
//
// P8's guarantee -- "the curve is visible without expanding a disclosure" --
// still holds here in an equivalent form: this component is never rendered
// inside a <details>. It is shown by selecting the "Amplification curve"
// view instead of by opening a disclosure; see P12-PLOT-TOGGLE.md's "P8
// guarantee" section for the full argument.
//
// WellDetailPanel's P7 numeric time-series table needs the exact same
// getAmplification response and fetches it independently rather than
// reading it from here -- keeping this component self-contained (so it
// stays unit-testable on its own, and keeps working if it is ever the only
// one mounted) costs one duplicate GET per well selection, which is a
// deliberate, documented trade against the alternative of a shared-cache
// coupling that would make WellDetailPanel's table depend on this
// component being mounted somewhere. See P12-PLOT-TOGGLE.md.
import { useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout, Shape } from "plotly.js";
import { useSessionStore } from "@/stores/session-store";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getAmplification } from "@/lib/api";
import { channelLabels } from "@/lib/channel-labels";
import { plotlyColors } from "@/lib/plotly-theme";
import { useRequestStatus } from "@/hooks/use-request-status";
import { StatusState } from "@/components/shared/ui";
import type { AmplificationCurve } from "@/types/api";

type AmplificationCurvePanelProps = {
  /** Whether the curve view is the one currently selected. This component
   *  stays mounted (and keeps fetching/redrawing on selection changes) even
   *  while the scatter view is showing, so its Plotly instance survives
   *  toggling back and forth -- but the FIRST draw can happen while its
   *  container is `display: none` (0x0), which bakes a zero-size layout
   *  into Plotly's SVG. Resize once, right when it becomes the visible
   *  view, to recover from that -- harmless to call again if the size was
   *  already correct. */
  active: boolean;
  /** P12-PLOT-TOGGLE: the same toggle-button node ScatterPlot renders in
   *  its own slim row above ScatterViewControls, mirrored here so the
   *  toggle stays in the same visual "slot" whichever view is active. */
  viewToggle?: ReactNode;
  /** MultiMarkerAnalysisPanel already wraps MarkerScatterPlot (and this,
   *  when toggled to) in its OWN `.panel` that also holds the marker
   *  badges/toolbar/NTC note -- adding a second nested `.panel` card there
   *  would double the border/background. `bare` skips this component's own
   *  outer card so it sits directly inside that existing one instead.
   *  Default false: ResultsPlotToggle's single-marker usage needs its own
   *  card, matching ScatterPlot's `.panel.scatter-panel`. */
  bare?: boolean;
};

export function AmplificationCurvePanel({ active, viewToggle, bare = false }: AmplificationCurvePanelProps) {
  const { t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const plotInitRef = useRef(false);
  const attachPlot = useCallback((node: HTMLDivElement | null) => {
    plotRef.current = node;
    if (!node) return;
    return () => {
      if (plotInitRef.current) Plotly.purge(node);
      plotInitRef.current = false;
      plotRef.current = null;
    };
  }, []);

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const selectedWell = useSelectionStore((s) => s.selectedWell);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);

  const numCycles = sessionInfo?.num_cycles ?? 1;
  const hasMultiCycleData = numCycles > 1;

  // P20-STALE-DATA: identifies WHICH well/condition the plot should be
  // showing -- deliberately NOT including `currentCycle` (that only moves
  // the vertical marker line below; the curve itself is the same series
  // regardless of cycle). Whenever this changes, the previous identity's
  // status/error must not be shown against the new one -- see
  // useRequestStatus. `sessionId` is included so a session switch cannot
  // read as "same well" by coincidence.
  const fetchKey = JSON.stringify([sessionId, selectedWell, useRox, backgroundMode]);
  const { status, setStatus, error, setError } = useRequestStatus(fetchKey);
  const identityRef = useRef<string | null>(null);

  // Fetch and plot the amplification curve when the selected well changes.
  // Runs regardless of `active` -- switching to the curve view should show
  // the already-current well immediately, not trigger a fresh fetch.
  useEffect(() => {
    const identityChanged = identityRef.current !== fetchKey;
    identityRef.current = fetchKey;

    if (!selectedWell || !sessionId || !hasMultiCycleData || !plotRef.current) {
      if (plotRef.current && plotInitRef.current) {
        Plotly.purge(plotRef.current);
        plotInitRef.current = false;
      }
      return;
    }

    // A new well/condition is being fetched: purge whatever the PREVIOUS
    // one drew. Without this, a failed (or still in-flight) request for the
    // new identity leaves the OLD well's curve on screen with nothing
    // marking it as stale -- exactly what a covering loading/error overlay
    // (below) already hides visually, but purging removes the wrong data
    // from the chart itself too, not just from view.
    if (identityChanged && plotInitRef.current) {
      Plotly.purge(plotRef.current);
      plotInitRef.current = false;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await getAmplification(sessionId, [selectedWell], useRox, backgroundMode);
        if (cancelled || !plotRef.current) return;

        const fetchedCurve: AmplificationCurve | undefined = res.curves[0];
        if (!fetchedCurve) {
          setStatus('empty');
          return;
        }
        const labels = channelLabels(
          res.channel_labels ? res : { channel_labels: roleLabels ?? undefined },
          res.allele2_dye || allele2Dye
        );

        const traces: Data[] = [
          {
            x: fetchedCurve.cycles,
            y: fetchedCurve.norm_fam,
            name: labels.fam,
            line: { color: "#2563eb", width: 2 },
          },
          {
            x: fetchedCurve.cycles,
            y: fetchedCurve.norm_allele2,
            name: labels.allele2,
            line: { color: "#dc2626", width: 2 },
          },
        ];

        const shapes: Partial<Shape>[] = currentCycle
          ? [
              {
                type: "line",
                x0: currentCycle,
                x1: currentCycle,
                y0: 0,
                y1: 1,
                yref: "paper",
                line: { color: "#9ca3af", width: 1, dash: "dot" },
              },
            ]
          : [];

        const c = plotlyColors();
        const layout: Partial<Layout> = {
          xaxis: { title: { text: t.axisCycle }, gridcolor: c.gridColor },
          // The curve now lives in the same large plot area as ScatterPlot
          // (no more 135px cap), so automargin only guards against a future,
          // even longer translation -- it isn't compensating for a tight fit.
          yaxis: { title: { text: t.curveReportedSignal }, automargin: true, gridcolor: c.gridColor },
          paper_bgcolor: c.paper_bgcolor,
          plot_bgcolor: c.plot_bgcolor,
          font: { color: c.fontColor },
          margin: { t: 10, r: 10, b: 50, l: 60 },
          legend: { x: 0, y: 1, bgcolor: c.legendBg },
          shapes,
        };

        Plotly.react(plotRef.current, traces, layout, {
          responsive: true,
          displayModeBar: false,
        });
        plotInitRef.current = true;
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        // P20-STALE-DATA: this used to be console-only, leaving the
        // PREVIOUS well's curve on screen with no indication anything went
        // wrong for the well/condition now selected.
        console.error("Failed to fetch amplification:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWell, sessionId, useRox, backgroundMode, currentCycle, allele2Dye, roleLabels, hasMultiCycleData, fetchKey, setStatus, setError, t.axisCycle, t.curveReportedSignal]);

  // See the `active` prop's doc comment: recover from a first draw that
  // happened while this view was hidden.
  useEffect(() => {
    if (!active || !plotInitRef.current || !plotRef.current) return;
    Plotly.Plots.resize(plotRef.current);
  }, [active]);

  // Same `.panel` card ScatterPlot.tsx wraps itself in, so the results
  // plot area's card outline stays put across the toggle and only its
  // interior content swaps -- .analysis-scatter-canvas is the same sizing
  // rule ScatterPlot's canvas div uses (see this file's decision note in
  // P12-PLOT-TOGGLE.md on sharing it rather than a curve-specific rule).
  //
  // The header bar mirrors ScatterViewControls' `scatter-plot-header`
  // (same classes/height) so the toggle sits in the same slot in both
  // views -- see the `viewToggle` prop's doc comment.
  let body: ReactNode;
  if (!selectedWell) {
    body = (
      <div className="relative analysis-scatter-canvas flex items-center justify-center">
        <p className="placeholder text-sm text-text-muted">{t.clickWellToSee}</p>
      </div>
    );
  } else if (!hasMultiCycleData) {
    body = (
      <div className="relative analysis-scatter-canvas flex items-center justify-center">
        <p className="text-sm text-text-muted">{t.curveNoMultiCycleData}</p>
      </div>
    );
  } else {
    // P20-STALE-DATA: an overlay covers the (always-mounted) Plotly
    // container while loading, on error, or when the well has no curve to
    // show -- same pattern ScatterPlot.tsx already uses for its own scatter
    // fetch -- so a previous well/condition's plot is never left visible
    // looking like it belongs to the one now selected.
    const overlay =
      status === "loading" ? (
        <StatusState variant="loading" message={t.loading} />
      ) : status === "error" ? (
        <StatusState variant="error" message={t.statusLoadFailed} detail={error ?? undefined} />
      ) : status === "empty" ? (
        <StatusState variant="empty" message={t.noDataForWell(selectedWell)} />
      ) : null;
    body = (
      <div className="relative analysis-scatter-canvas flex flex-col">
        <p className="text-xs text-text-muted mb-1" data-testid="curve-reading-basis">{t.referenceBasisUnknown}</p>
        <div className="relative" style={{ flex: "1 1 auto", minHeight: 0 }}>
          <div
            id="amplification-plot"
            ref={attachPlot}
            style={{ width: "100%", height: "100%" }}
          />
          {overlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface">
              {overlay}
            </div>
          )}
        </div>
      </div>
    );
  }

  const content = (
    <>
      {viewToggle && <div className="mb-1 xl:mb-px flex justify-end">{viewToggle}</div>}
      {body}
    </>
  );

  return bare ? content : <div className="panel curve-panel">{content}</div>;
}
