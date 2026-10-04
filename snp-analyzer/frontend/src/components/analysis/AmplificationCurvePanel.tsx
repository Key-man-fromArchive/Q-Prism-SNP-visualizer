// @TASK P12-TOGGLE - Amplification curve view (results screen large plot area)
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
// @TEST src/components/analysis/AmplificationCurvePanel.test.tsx
// @TASK MULTI-CURVE-T2 - several selected wells draw together (see lib/amplification-traces.ts)
// @SPEC docs/planning/multi-well-curves-2026-10-04/PLAN.md
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
import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Plotly from "plotly.js-dist-min";
import type { Layout, PlotHoverEvent, Shape } from "plotly.js";
import { useSessionStore } from "@/stores/session-store";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { useCurveViewStore } from "@/stores/curve-view-store";
import { getAmplification } from "@/lib/api";
import { channelLabels } from "@/lib/channel-labels";
import { callAppearance, cycleReadText } from "@/lib/chart-semantics";
import { plotlyColors } from "@/lib/plotly-theme";
import { wellInfo } from "@/lib/genotype";
import { callForWell } from "@/lib/well-call";
import { markNoAmplification, useNoAmplificationWells } from "@/lib/amplification-qc";
import {
  HOVER_EMPHASIS_MAX, WELL_COLOUR_MAX, buildMultiWellTraces, emphasisRestyle,
  type ColourBasis, type CurveChannels, type TraceMeta,
} from "@/lib/amplification-traces";
import { useRequestStatus } from "@/hooks/use-request-status";
import { useIsDarkMode } from "@/hooks/use-dark-mode";
import { StatusState } from "@/components/shared/ui";
import { callTexts } from "./call-text";
import type { AlleleLabels, AmplificationResponse } from "@/types/api";

/** Past this many wells the lines overlap too much to tell apart. */
const OVERLAP_NOTE_WELLS = 200;
/** Wait for a burst of multi-well selection changes (drag, Ctrl+click) to settle. */
const MULTI_SELECTION_DEBOUNCE_MS = 150;

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
  /** The call each well shows (null: none). Defaults to the plate's manual /
   *  automatic call under the display settings -- the rule PlateView uses. */
  callOf?: (well: string) => string | null;
  /** The marker allele names that apply to a well, for naming calls. */
  alleleLabelsOf?: (well: string) => AlleleLabels | null | undefined;
  /** The marker's ploidy on screens that analyse one marker at a time. */
  ploidyOverride?: number;
};

type CurveData = { key: string; res: AmplificationResponse };
type PlotElement = HTMLDivElement & {
  on?: (event: string, handler: (event: PlotHoverEvent) => void) => void;
};

function cycleShapes(currentCycle: number): Partial<Shape>[] {
  return currentCycle
    ? [{
        type: "line", x0: currentCycle, x1: currentCycle, y0: 0, y1: 1, yref: "paper",
        line: { color: "#9ca3af", width: 1, dash: "dot" },
      }]
    : [];
}

type SegmentedOption<V extends string> = { value: V; label: string; disabled?: boolean; title?: string };

function Segmented<V extends string>({ label, value, options, onChange, testId }: {
  label: string; value: V; options: SegmentedOption<V>[]; onChange: (v: V) => void; testId: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label} data-testid={testId}>
      <span className="text-xs text-text-muted">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-testid={`${testId}-${o.value}`}
          aria-pressed={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-40 ${
            value === o.value
              ? "border-primary bg-primary text-on-primary"
              : "border-border bg-surface text-text hover:border-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AmplificationCurvePanel({ active, viewToggle, bare = false, callOf, alleleLabelsOf, ploidyOverride }: AmplificationCurvePanelProps) {
  const { t } = useI18n();
  const dark = useIsDarkMode();
  const plotRef = useRef<HTMLDivElement>(null);
  const plotInitRef = useRef(false);
  const hoverBoundRef = useRef(false);
  const attachPlot = useCallback((node: HTMLDivElement | null) => {
    plotRef.current = node;
    if (!node) return;
    return () => {
      if (plotInitRef.current) Plotly.purge(node);
      plotInitRef.current = false;
      hoverBoundRef.current = false;
      plotRef.current = null;
    };
  }, []);

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const showManualTypes = useSettingsStore((s) => s.showManualTypes);
  const showAutoCluster = useSettingsStore((s) => s.showAutoCluster);
  const storedPloidy = useSettingsStore((s) => s.ploidy);
  const ploidy = ploidyOverride ?? storedPloidy;
  const selectedWell = useSelectionStore((s) => s.selectedWell);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const plateWells = useDataStore((s) => s.plateWells);
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const noAmplification = useNoAmplificationWells();
  const channels = useCurveViewStore((s) => s.channels);
  const storedBasis = useCurveViewStore((s) => s.colourBasis);
  const yScale = useCurveViewStore((s) => s.yScale);
  const setChannels = useCurveViewStore((s) => s.setChannels);
  const setColourBasis = useCurveViewStore((s) => s.setColourBasis);
  const setYScale = useCurveViewStore((s) => s.setYScale);

  const numCycles = sessionInfo?.num_cycles ?? 1;
  const hasMultiCycleData = numCycles > 1;

  // Selected wells, sorted and de-duplicated so the same set always means the
  // same request. A lone `selectedWell` (no list) still counts as a selection.
  const wellsKey = useMemo(() => {
    const list = selectedWells.length ? selectedWells : selectedWell ? [selectedWell] : [];
    return [...new Set(list)].sort().join(",");
  }, [selectedWells, selectedWell]);
  const wells = useMemo(() => (wellsKey ? wellsKey.split(",") : []), [wellsKey]);

  // P20-STALE-DATA: identifies WHICH wells/condition the plot should be
  // showing -- deliberately NOT including `currentCycle` (that only moves
  // the vertical marker line below; the curves themselves are the same
  // series regardless of cycle). Whenever this changes, the previous
  // identity's status/error must not be shown against the new one -- see
  // useRequestStatus. `sessionId` is included so a session switch cannot
  // read as "same wells" by coincidence.
  const fetchKey = JSON.stringify([sessionId, wellsKey, useRox, backgroundMode]);
  const { status, setStatus, error, setError } = useRequestStatus(fetchKey);
  const identityRef = useRef<string | null>(null);
  const previousCountRef = useRef(0);
  const [data, setData] = useState<CurveData | null>(null);

  // Fetch the curves when the selected wells or the reading condition change.
  // Runs regardless of `active` -- switching to the curve view should show
  // the already-current wells immediately, not trigger a fresh fetch. A cycle
  // change never gets here.
  useEffect(() => {
    const identityChanged = identityRef.current !== fetchKey;
    identityRef.current = fetchKey;
    const count = wells.length;
    const previousCount = previousCountRef.current;
    previousCountRef.current = count;

    if (count === 0 || !sessionId || !hasMultiCycleData || !plotRef.current) {
      if (plotRef.current && plotInitRef.current) {
        Plotly.purge(plotRef.current);
        plotInitRef.current = false;
        hoverBoundRef.current = false;
      }
      return;
    }

    // New wells/condition are being fetched: purge whatever the PREVIOUS
    // ones drew. Without this, a failed (or still in-flight) request leaves
    // the OLD curves on screen with nothing marking them as stale -- exactly
    // what a covering loading/error overlay (below) already hides visually,
    // but purging removes the wrong data from the chart itself too.
    if (identityChanged && plotInitRef.current) {
      Plotly.purge(plotRef.current);
      plotInitRef.current = false;
      hoverBoundRef.current = false;
    }

    let cancelled = false;
    const controller = new AbortController();
    const run = async () => {
      try {
        const res = await getAmplification(sessionId, wells, useRox, backgroundMode, controller.signal);
        if (cancelled) return;
        setData({ key: fetchKey, res });
        setStatus(res.curves.length > 0 ? 'ready' : 'empty');
      } catch (err) {
        if (cancelled) return;
        // P20-STALE-DATA: this used to be console-only, leaving the
        // PREVIOUS well's curve on screen with no indication anything went
        // wrong for the well/condition now selected.
        console.error("Failed to fetch amplification:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    };

    // Only a change from several wells to several other wells waits: that is
    // the drag / Ctrl+click burst. The first well, or clearing, is immediate.
    const debounce = previousCount >= 2 && count >= 2;
    const timer = debounce ? setTimeout(run, MULTI_SELECTION_DEBOUNCE_MS) : undefined;
    if (!debounce) void run();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [wellsKey, wells, sessionId, useRox, backgroundMode, hasMultiCycleData, fetchKey, setStatus, setError]);

  // Which call each well shows: the screen's own rule when it passes one,
  // otherwise the plate's (same function PlateView uses).
  const fallbackCallOf = useMemo(() => {
    const points = new Map<string, { well: string; manual_type: string | null; auto_cluster: string | null }>();
    for (const p of scatterPoints) points.set(p.well, p);
    for (const p of markNoAmplification(plateWells, noAmplification)) points.set(p.well, p);
    return (well: string) => callForWell(well, { points, showManualTypes, showAutoCluster });
  }, [scatterPoints, plateWells, noAmplification, showManualTypes, showAutoCluster]);
  // Only the selected wells' calls matter, and the plate rows are replaced on
  // every cycle step (PlateView refetches per cycle): key on the call values so
  // a cycle change does not look like a new rule and redraw the curves.
  const rawCallOf = callOf ?? fallbackCallOf;
  const callKey = wells.map((w) => rawCallOf(w) ?? "").join("\u0000");
  const wellCall = useMemo(() => {
    const calls = callKey.split("\u0000");
    const byWell = new Map(wells.map((w, i) => [w, calls[i] || null] as const));
    return (well: string) => byWell.get(well) ?? null;
  }, [wells, callKey]);

  const hasCallData = useMemo(() => wells.some((w) => wellCall(w) !== null), [wells, wellCall]);
  const basis: ColourBasis =
    wells.length < 2 ? "channel"
    : storedBasis === "call" && !hasCallData ? "channel"
    : storedBasis === "well" && wells.length > WELL_COLOUR_MAX ? "channel"
    : storedBasis;

  const built = useMemo(() => {
    if (!data || data.key !== fetchKey || data.res.curves.length === 0) return null;
    const res = data.res;
    const labels = channelLabels(
      res.channel_labels ? res : { channel_labels: roleLabels ?? undefined },
      res.allele2_dye || allele2Dye
    );
    const callName = (call: string, well: string) => {
      const appearance = callTexts(call, t, callAppearance(call, ploidy, dark, t), alleleLabelsOf?.(well));
      return appearance.label || appearance.description;
    };
    return {
      labels,
      result: buildMultiWellTraces({
        curves: res.curves,
        channels: res.curves.length > 1 ? channels : "both",
        colourBasis: basis,
        yScale,
        channelNames: labels,
        callOf: wellCall,
        callName,
        callColor: (call) => wellInfo(call, ploidy, dark).color,
        texts: { unassigned: t.wellTypeUnassigned, cycle: t.axisCycle },
      }),
    };
  }, [data, fetchKey, roleLabels, allele2Dye, channels, basis, yScale, wellCall, alleleLabelsOf, ploidy, dark, t]);

  const tracesRef = useRef<{ traces: NonNullable<typeof built>["result"]["traces"]; mode: string }>({ traces: [], mode: "single" });

  // Draw. The cycle marker line is read from the store here rather than
  // subscribed to: moving it must not redraw (see the relayout effect below).
  useEffect(() => {
    const el = plotRef.current as PlotElement | null;
    if (!built || !el) return;
    const { result } = built;
    const firstCycles = data?.res.curves[0]?.cycles ?? [];
    tracesRef.current = { traces: result.traces, mode: result.mode };

    const c = plotlyColors();
    // Endpoint-only runs (D-9): the x positions are reads, not PCR cycles, so name them.
    const readTicks = sessionInfo?.has_amplification_curve === false && sessionInfo.read_labels
      ? firstCycles.map((cycle) => cycleReadText(cycle, sessionInfo.read_labels, t) ?? String(cycle))
      : null;
    const layout: Partial<Layout> = {
      xaxis: readTicks
        ? { tickmode: "array", tickvals: firstCycles, ticktext: readTicks, gridcolor: c.gridColor }
        : { title: { text: t.axisCycle }, gridcolor: c.gridColor },
      // The curve now lives in the same large plot area as ScatterPlot
      // (no more 135px cap), so automargin only guards against a future,
      // even longer translation -- it isn't compensating for a tight fit.
      yaxis: { title: { text: t.curveReportedSignal }, type: yScale, automargin: true, gridcolor: c.gridColor },
      paper_bgcolor: c.paper_bgcolor,
      plot_bgcolor: c.plot_bgcolor,
      font: { color: c.fontColor },
      margin: { t: 10, r: 10, b: 50, l: 60 },
      legend: { x: 0, y: 1, bgcolor: c.legendBg },
      hovermode: "closest",
      shapes: cycleShapes(useSelectionStore.getState().currentCycle),
    };

    Plotly.react(el, result.traces, layout, { responsive: true, displayModeBar: false });
    plotInitRef.current = true;

    // Hovering a well's line emphasises that well (per-well traces only).
    if (!hoverBoundRef.current && typeof el.on === "function") {
      hoverBoundRef.current = true;
      el.on("plotly_hover", (event) => {
        const meta = (event.points?.[0]?.data as { meta?: TraceMeta } | undefined)?.meta;
        if (tracesRef.current.mode === "per-well" && meta?.well) {
          void Plotly.restyle(el, emphasisRestyle(tracesRef.current.traces, meta.well) as never);
        }
      });
      el.on("plotly_unhover", () => {
        if (tracesRef.current.mode === "per-well") void Plotly.restyle(el, emphasisRestyle(tracesRef.current.traces, null) as never);
      });
    }
  }, [built, data, yScale, t, sessionInfo, dark]);

  // The cycle line only moves; the curves are not refetched or redrawn.
  useEffect(() => {
    if (!plotInitRef.current || !plotRef.current) return;
    void Plotly.relayout(plotRef.current, { shapes: cycleShapes(currentCycle) });
  }, [currentCycle]);

  // See the `active` prop's doc comment: recover from a first draw that
  // happened while this view was hidden.
  useEffect(() => {
    if (!active || !plotInitRef.current || !plotRef.current) return;
    Plotly.Plots.resize(plotRef.current);
  }, [active]);

  const missingWells = data && data.key === fetchKey ? Math.max(0, wells.length - data.res.curves.length) : 0;
  const callSummary = useMemo(() => {
    if (!data || data.key !== fetchKey || !hasCallData) return "";
    const counts = new Map<string, number>();
    for (const curve of data.res.curves) {
      const call = wellCall(curve.well);
      const name = call === null ? t.wellTypeUnassigned : (() => {
        const appearance = callTexts(call, t, callAppearance(call, ploidy, dark, t), alleleLabelsOf?.(curve.well));
        return appearance.label || appearance.description;
      })();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, n]) => `${name} ${n}`).join(", ");
  }, [data, fetchKey, hasCallData, wellCall, alleleLabelsOf, ploidy, dark, t]);

  const multi = wells.length >= 2;
  const channelOptions: SegmentedOption<CurveChannels>[] = [
    { value: "both", label: t.curveChannelBoth },
    { value: "fam", label: built?.labels.fam ?? "FAM" },
    { value: "allele2", label: built?.labels.allele2 ?? "Allele 2" },
  ];
  const basisOptions: SegmentedOption<ColourBasis>[] = [
    { value: "channel", label: t.curveColourChannel },
    { value: "call", label: t.curveColourCall, disabled: !hasCallData, title: hasCallData ? undefined : t.curveColourCallDisabled },
    { value: "well", label: t.curveColourWell, disabled: wells.length > WELL_COLOUR_MAX, title: wells.length > WELL_COLOUR_MAX ? t.curveColourWellDisabled : undefined },
  ];

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
  if (wells.length === 0) {
    body = (
      <div className="relative analysis-scatter-canvas flex items-center justify-center">
        <p className="placeholder text-sm text-text-muted">{t.curveSelectWells}</p>
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
    // container while loading, on error, or when the wells have no curve to
    // show -- same pattern ScatterPlot.tsx already uses for its own scatter
    // fetch -- so a previous well/condition's plot is never left visible
    // looking like it belongs to the one now selected.
    const overlay =
      status === "loading" ? (
        <StatusState variant="loading" message={t.loading} />
      ) : status === "error" ? (
        <StatusState variant="error" message={t.statusLoadFailed} detail={error ?? undefined} />
      ) : status === "empty" ? (
        <StatusState variant="empty" message={wells.length === 1 ? t.noDataForWell(wells[0]) : t.curveNoCurveWells(wells.length)} />
      ) : null;
    const hidden = built?.result.hiddenNonPositive ?? 0;
    body = (
      <div className="relative analysis-scatter-canvas flex flex-col">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="curve-controls">
          {multi && (
            <span className="text-xs font-medium text-text" data-testid="curve-selected-count"
              title={wells.length <= HOVER_EMPHASIS_MAX ? t.curveHoverEmphasisHint : undefined}>
              {t.curveSelectedWells(wells.length)}
            </span>
          )}
          {multi && <Segmented label={t.curveChannelGroup} value={channels} options={channelOptions} onChange={setChannels} testId="curve-channels" />}
          {multi && <Segmented label={t.curveColourGroup} value={basis} options={basisOptions} onChange={setColourBasis} testId="curve-colour-basis" />}
          <Segmented
            label={t.curveScaleGroup}
            value={yScale}
            options={[{ value: "linear", label: t.curveScaleLinear }, { value: "log", label: t.curveScaleLog }]}
            onChange={setYScale}
            testId="curve-yscale"
          />
        </div>
        <p className="text-xs text-text-muted mb-1" data-testid="curve-reading-basis">{t.referenceBasisUnknown}</p>
        <div className="mb-1 flex flex-wrap gap-x-3 text-xs text-text-muted">
          {multi && <span>{t.curveLineShapeNote}</span>}
          {status === "ready" && missingWells > 0 && <span data-testid="curve-missing-wells">{t.curveNoCurveWells(missingWells)}</span>}
          {status === "ready" && yScale === "log" && hidden > 0 && <span data-testid="curve-hidden-nonpositive">{t.curveHiddenNonPositive(hidden)}</span>}
          {wells.length > OVERLAP_NOTE_WELLS && <span data-testid="curve-overlap-note">{t.curveManyOverlap}</span>}
        </div>
        {status === "ready" && multi && (
          <p className="sr-only" aria-live="polite" data-testid="curve-summary">
            {t.curveSummary(wells.length - missingWells, missingWells, callSummary)}
          </p>
        )}
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
