import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout, Config, Shape, PlotlyHTMLElement, PlotMouseEvent, PlotSelectionEvent } from "plotly.js";
import { useSessionStore } from "@/stores/session-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ScatterAspect } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getScatter } from "@/lib/api";
import { analyzeCurrent } from "@/lib/analysis-actions";
import { useAnalysisStore } from '@/stores/analysis-store';
import { ownsChartResult } from '@/lib/chart-export-owner';
import { channelLabels, normalizationLabel, normalizedLabel } from "@/lib/channel-labels";
import { WELL_TYPE_INFO } from "@/lib/constants";
import { genotypeClasses, labelByRatio, defaultRatioCuts } from "@/lib/genotype";
import { chartCategory, callLabel, chartPointState, chartStateText } from "@/lib/chart-semantics";
import { plotlyColors } from "@/lib/plotly-theme";
import { axisRangeLayout, dataBounds, visibleBounds } from "@/lib/scatter-axes";
import { useWellFilter } from "@/hooks/use-well-filter";
import { useQualityRevealedWell } from '@/hooks/use-quality-reveal';
import { visibleQualityPoint } from '@/lib/quality-display';
import { useI18n } from "@/hooks/use-i18n";
import { useIsDarkMode } from "@/hooks/use-dark-mode";
import { StatusState } from "@/components/shared/ui";
import { ScatterViewControls } from "./ScatterViewControls";
import type { ScatterPoint } from "@/types/api";
import { clientPoint, textCustomdata, type PlotlyAxis } from "@/lib/plot-coordinates";
import { clearActiveChart, setActiveChart } from "@/lib/chart-export-registry";

type PlotlyGraphDiv = HTMLDivElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
  data?: Array<Record<string, unknown>>;
};

// P12-TOGGLE (FB-12): shrunk from 12/10/18 -- the user asked for smaller
// dots, keeping the existing shape-per-genotype coding (SYMBOLS in
// chart-semantics.ts) unchanged since that is the only non-color
// distinction for color-blind/print use, and PlateLegend uses the same
// glyphs. MarkerScatterPlot.tsx mirrors these exact values so the two plots
// read consistently. Checked at this size (screenshots in
// evidence/P12-PLOT-TOGGLE.md) that triangle-up/square/diamond-open are
// still visually distinct at 1x and under a 2x crop -- smaller made the
// filled shapes converge toward indistinguishable dots.
const MARKER_SIZE = 8;
const MARKER_SIZE_NTC = 7;
const MARKER_SIZE_SELECTED = 12;
// Individual well-number labels stop being drawn past this many selected
// wells -- past a handful, a label per point on a 96/384-well plate turns
// into unreadable clutter (the whole reason dot size was reduced in the
// first place). The hover tooltip's first line ("Well: A1") still answers
// "which well is this" for a single point either way.
const MAX_WELL_LABELS = 8;

// Feeds `.analysis-scatter-canvas`'s `aspect-ratio` (index.css, P4-S1-T1):
// the canvas is bound by width so the ratio always holds, and the ratio
// itself comes from here rather than a fixed value (FB-04 §3-1, D-6).
function scatterAspectVars(aspect: ScatterAspect): CSSProperties {
  const [w, h] = aspect === "1:1" ? [1, 1] : [4, 3];
  return { "--scatter-aspect-w": w, "--scatter-aspect-h": h } as CSSProperties;
}

function useBoundaryDraft(seed: number[] | null) {
  const [previousSeed, setPreviousSeed] = useState(seed);
  const [draft, setDraft] = useState(seed);
  if (previousSeed !== seed) {
    setPreviousSeed(seed);
    setDraft(seed);
  }
  return [draft, setDraft] as const;
}

function useScatterStatus(key: string, sessionId: string | null) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState({ key, sessionId });
  if (lastFetch.key !== key) {
    setLastFetch({ key, sessionId });
    setStatus(status === "ready" && lastFetch.sessionId === sessionId ? "ready" : "loading");
    setFetchError(null);
  }
  return { status, setStatus, fetchError, setFetchError };
}

function effectiveType(
  autoCluster: string | null,
  manualType: string | null,
  showAuto: boolean,
  showManual: boolean
): string | null {
  if (showManual && manualType) return manualType;
  if (showAuto && autoCluster) return autoCluster;
  return null;
}

type ScatterPlotProps = {
  /** Whether the scatter view is the one currently selected in
   *  ResultsPlotToggle (default true: ScatterPlot has no other caller).
   *  Toggling the curve/scatter views hides the inactive one with an
   *  inline `display: none` rather than unmounting it, so a resize on
   *  becoming active recovers the WebGL canvas from any size Plotly
   *  computed for it while its container had zero size -- see
   *  AmplificationCurvePanel's `active` prop for the mirrored case. */
  active?: boolean;
  /** P12-PLOT-TOGGLE: the scatter/curve toggle buttons, threaded through to
   *  ScatterViewControls' header row -- see that prop's doc comment for why
   *  it lives there instead of in a row ScatterPlot adds itself. */
  viewToggle?: ReactNode;
};

export function ScatterPlot({ active = true, viewToggle }: ScatterPlotProps = {}) {
  const { t } = useI18n();
  // The dosage palette has its own dark steps, so a theme change has to rebuild
  // the traces -- the chrome-only relayout below cannot repaint markers.
  const dark = useIsDarkMode();
  const plotRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const exportRender = useRef(0);

  const sessionId = useSessionStore((s) => s.sessionId);
  const hasNormalizationChannel = useSessionStore((s) => s.sessionInfo?.has_rox === true);
  const useRox = useSettingsStore((s) => s.useRox);
  const axisMode = useSettingsStore((s) => s.axisMode);
  const lockAspect = useSettingsStore((s) => s.lockAspect);
  const scatterTool = useSettingsStore((s) => s.scatterTool);
  const scatterAspect = useSettingsStore((s) => s.scatterAspect);
  const xMin = useSettingsStore((s) => s.xMin);
  const xMax = useSettingsStore((s) => s.xMax);
  const yMin = useSettingsStore((s) => s.yMin);
  const yMax = useSettingsStore((s) => s.yMax);
  const xNtcOffsetRaw = useSettingsStore((s) => s.xNtcOffsetRaw);
  const yNtcOffsetRaw = useSettingsStore((s) => s.yNtcOffsetRaw);
  const xNtcOffsetNormalized = useSettingsStore((s) => s.xNtcOffsetNormalized);
  const yNtcOffsetNormalized = useSettingsStore((s) => s.yNtcOffsetNormalized);
  const showAutoCluster = useSettingsStore((s) => s.showAutoCluster);
  const showManualTypes = useSettingsStore((s) => s.showManualTypes);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const ploidy = useSettingsStore((s) => s.ploidy);
  const ntcThreshold = useSettingsStore((s) => s.ntcThreshold);
  const showBoundaryLines = useSettingsStore((s) => s.showBoundaryLines);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const selectWell = useSelectionStore((s) => s.selectWell);
  const selectWells = useSelectionStore((s) => s.selectWells);
  const addWells = useSelectionStore((s) => s.addWells);
  const toggleWell = useSelectionStore((s) => s.toggleWell);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const focusSelectedWells = useSelectionStore((s) => s.focusSelectedWells);
  const selectedWellSet = useMemo(() => new Set(selectedWells), [selectedWells]);
  // "Selected only" is a view preference and outlives a cleared selection, so
  // it must not be able to empty the plot on its own.
  const focusActive = focusSelectedWells && selectedWells.length > 0;
  const scatterPoints = useDataStore((s) => s.scatterPoints);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const clusterAssignments = useDataStore((s) => s.clusterAssignments);
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);
  const ratioOrigin = useDataStore((s) => s.ratioOrigin);
  // Whether the plotted values really were divided by the passive reference.
  // The axis titles, the hover text and the decimal count all follow THIS, not
  // the `useRox` request: a run with no reference comes back raw either way,
  // and titling the axis "FAM / ROX" over raw RFU misreports the data.
  const normalizationApplied = useDataStore((s) => s.normalizationApplied);
  const ntcAxisOffsets = useMemo(
    () => normalizationApplied
      ? { x: xNtcOffsetNormalized, y: yNtcOffsetNormalized }
      : { x: xNtcOffsetRaw, y: yNtcOffsetRaw },
    [normalizationApplied, xNtcOffsetNormalized, yNtcOffsetNormalized, xNtcOffsetRaw, yNtcOffsetRaw]
  );
  const roxOutlierWells = useDataStore((s) => s.roxOutlierWells);
  // The drag handlers are registered once per tool-open, so they read the
  // origin through a ref rather than re-binding every time it changes.
  const originRef = useRef(ratioOrigin);
  useEffect(() => {
    originRef.current = ratioOrigin;
  }, [ratioOrigin]);
  const setScatterData = useDataStore((s) => s.setScatterData);
  const boundaries = useDataStore((s) => s.boundaries);
  const offset = useDataStore((s) => s.offset);
  const offsetUncertain = useDataStore((s) => s.offsetUncertain);
  const dosageMax = useDataStore((s) => s.dosageMax);
  const ntcCorner = useDataStore((s) => s.ntcCorner);
  const setNtcCorner = useDataStore((s) => s.setNtcCorner);
  const { isWellVisible } = useWellFilter();
  const revealedWell = useQualityRevealedWell();
  const visiblePoints = useMemo(() => scatterPoints.filter(point => visibleQualityPoint(point, revealedWell,
    isWellVisible(point.well), focusActive, selectedWellSet)), [scatterPoints, revealedWell, isWellVisible, focusActive, selectedWellSet]);

  const inferredNtcCorner = useMemo(() => {
    // EFFECTIVE type, manual over auto -- not "manual OR auto is NTC". A well
    // the operator has relabelled away from NTC must stop anchoring the
    // quadrant, otherwise the corner stays stranded on the wells the auto
    // detector got wrong and never recovers without a drag.
    const ntcs = scatterPoints.filter(
      (point) => (point.manual_type ?? point.auto_cluster) === "NTC"
    );
    const maxX = Math.max(1, ...scatterPoints.map((point) => point.norm_fam));
    const maxY = Math.max(1, ...scatterPoints.map((point) => point.norm_allele2));
    if (ntcs.length > 0) {
      return {
        fam: Math.max(...ntcs.map((point) => point.norm_fam)) + maxX * 0.02,
        allele2: Math.max(...ntcs.map((point) => point.norm_allele2)) + maxY * 0.02,
      };
    }
    return {
      fam: ratioOrigin.fam + maxX * 0.08,
      allele2: ratioOrigin.allele2 + maxY * 0.08,
    };
  }, [scatterPoints, ratioOrigin]);
  const effectiveNtcCorner = ntcCorner ?? inferredNtcCorner;
  const ntcLiveRef = useRef(effectiveNtcCorner);
  useEffect(() => {
    ntcLiveRef.current = effectiveNtcCorner;
  }, [effectiveNtcCorner]);

  // Draggable radial genotype-boundary lines (manual mode). Rendered only when
  // manual types are active AND the boundary toggle is on. The number of lines
  // equals the ploidy (P lines -> P+1 dosage wedges); adding/deleting a line
  // changes the ploidy in lockstep so selector, lines and classes stay in sync.
  const linesActive = showManualTypes && showBoundaryLines;
  // Rendering the rays and being able to drag them are different things: a ray
  // grab tests |cut - ratio| < 0.04 over the WHOLE canvas, which is an angular
  // wedge rather than a line, so leaving it armed made large parts of the plot
  // unselectable. See ScatterTool in the settings store.
  const editing = scatterTool === "edit";
  const seedBoundaries = useMemo(() => linesActive
    ? (boundaries?.length ? [...boundaries] : defaultRatioCuts(ploidy))
    : null, [linesActive, boundaries, ploidy]);
  const [editBoundaries, setEditBoundaries] = useBoundaryDraft(seedBoundaries);
  const editRef = useRef<number[] | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  // Sync the working copy from the stored boundaries whenever the tool opens or
  // a fresh analysis arrives (fall back to equal-spacing seeds).
  useEffect(() => {
    editRef.current = editBoundaries;
  }, [editBoundaries]);

  // Plotly's `plotly_selected` payload carries no modifier state, so the
  // modifiers are read off the mousedown that began the drag. (`plotly_click`
  // does hand over the original event; this covers the box/lasso case.)
  const additiveRef = useRef(false);
  useEffect(() => {
    const gd = plotRef.current;
    if (!gd) return;
    const onDown = (event: MouseEvent) => {
      additiveRef.current = event.ctrlKey || event.metaKey || event.shiftKey;
    };
    gd.addEventListener("mousedown", onDown);
    return () => gd.removeEventListener("mousedown", onDown);
  }, []);

  // Re-fetch trigger (incremented when well types change)
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Listen for well type changes to re-fetch scatter data
  useEffect(() => {
    const handler = () => setRefetchTrigger((n) => n + 1);
    window.addEventListener("welltypes-changed", handler);
    window.addEventListener("analysis-result-changed", handler);
    return () => {
      window.removeEventListener("welltypes-changed", handler);
      window.removeEventListener("analysis-result-changed", handler);
    };
  }, []);

  // Request lifecycle so the panel shows loading/empty/error instead of a blank
  // 560px void (PRD FR-ST-1/ST-3). `loading` covers both an in-flight fetch and
  // waiting for the cycle to initialise.
  const fetchKey = JSON.stringify([sessionId, currentCycle, useRox, backgroundMode, refetchTrigger]);
  const { status, setStatus, fetchError, setFetchError } = useScatterStatus(fetchKey, sessionId);
  const fetchRevision = useRef(0);
  const settledFetchKey = useRef<string | null>(null);
  const settledResponse = useRef<{ cycle: number; useRox: boolean; backgroundMode: typeof backgroundMode } | null>(null);

  // Fetch scatter data
  const fetchData = useCallback(() => {
    const revision = ++fetchRevision.current;
    if (!sessionId) return;
    return getScatter(sessionId, currentCycle, useRox, backgroundMode).then((res) => {
      if (revision !== fetchRevision.current) return;
      settledFetchKey.current = fetchKey;
      settledResponse.current = { cycle: res.cycle, useRox, backgroundMode: res.background_mode ?? backgroundMode };
      setScatterData(res.points, res.allele2_dye, res.channel_labels, res.ratio_origin, {
        applied: res.normalization_applied,
        roxOutlierWells: res.rox_outlier_wells,
      });
      setStatus("ready");
    }).catch((err: unknown) => {
      if (revision !== fetchRevision.current) return;
      console.error("Failed to fetch scatter data:", err);
      setFetchError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    });
  }, [sessionId, currentCycle, useRox, backgroundMode, fetchKey, setScatterData, setStatus, setFetchError]);

  useEffect(() => {
    void fetchData();
    return () => { fetchRevision.current += 1; };
  }, [fetchData, refetchTrigger]);

  // Build and render traces
  useEffect(() => {
    const token = ++exportRender.current;
    if (!plotRef.current || scatterPoints.length === 0) {
      if (plotRef.current) clearActiveChart(plotRef.current);
      return;
    }
    // Do not relabel the previous response with controls whose request is
    // still in flight. The chart becomes exportable only after this exact
    // response has supplied the displayed points.
    const responseIdentity = settledResponse.current;
    if (settledFetchKey.current !== fetchKey || !responseIdentity) {
      clearActiveChart(plotRef.current);
      return;
    }

    // Filter to only visible wells before grouping. Omitted wells are dropped
    // entirely (by manual_type, authoritative from the backend) so they never
    // become plot markers OR influence the auto-ranged x/y axes.

    // In boundary mode the wedges between the radial lines define the genotype
    // live: relabel each well by its fam-fraction against the current cuts +
    // window offset (controls/NTC and manual overrides still win). ploidy is the
    // fixed organism ploidy; the offset says which absolute dosages these zones
    // are (a 6x marker may show 3 zones = dosages 0,1,2 or 4,5,6).
    const bnd = linesActive ? editBoundaries : null;
    const boundaryType = (point: ScatterPoint): string => {
      if (showManualTypes && point.manual_type) return point.manual_type;
      const auto = point.auto_cluster;
      if (auto === "NTC" || auto === "Positive Control") return auto;
      // Measured from the plate's no-signal origin, not from (0, 0): the
      // points are raw RFU and both channels carry an optical background, so
      // ratios taken from zero collapse toward 0.5 for every well.
      const fam = Math.max(point.norm_fam - ratioOrigin.fam, 0);
      const allele2 = Math.max(point.norm_allele2 - ratioOrigin.allele2, 0);
      const total = fam + allele2;
      if (total <= 0) return "Unassigned";
      return labelByRatio(fam / total, ploidy, bnd!, offset);
    };

    // Group points by effective type
    const typeGroups = new Map<string, ScatterPoint[]>();
    for (const point of visiblePoints) {
      const type = bnd
        ? boundaryType(point)
        : effectiveType(point.auto_cluster, point.manual_type, showAutoCluster, showManualTypes) ||
          "Unassigned";
      if (!typeGroups.has(type)) typeGroups.set(type, []);
      typeGroups.get(type)!.push(point);
    }

    const colors = plotlyColors();
    const decimals = normalizationApplied ? 4 : 1;
    const traces: Data[] = [];
    const labels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);

    // Build traces in a deterministic order: dosage genotype classes (for the
    // current ploidy, highest dosage first), then control/non-genotype types,
    // then unassigned. WELL_TYPE_INFO keeps only the fixed control types here;
    // the diploid genotype trio comes from genotypeClasses so ploidy drives it.
    const diploidGeno = new Set(["Allele 1 Homo", "Allele 2 Homo", "Heterozygous"]);
    const genoKeys = genotypeClasses(ploidy, dark).map((c) => c.key);
    const controlKeys = Object.keys(WELL_TYPE_INFO).filter((k) => !diploidGeno.has(k));
    const typeOrder = [...genoKeys, ...controlKeys, "Unassigned"];
    for (const typeKey of typeOrder) {
      const points = typeGroups.get(typeKey);
      if (!points || points.length === 0) continue;

      const info = chartCategory(typeKey, ploidy, dark);

      traces.push({
        x: points.map((p) => p.norm_fam),
        y: points.map((p) => p.norm_allele2),
        mode: "markers",
        type: "scattergl",
        name: callLabel(typeKey, t),
        customdata: points.map((p) => p.well),
        text: points.map((p) => {
          const normSuffix = normalizationApplied ? ` / ${normalizationLabel(labels)}` : "";
          return (
            `<b>${t.chartWellAddress}: ${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>${t.chartCall}: ${callLabel(typeKey, t)}<br>` +
            `${labels.fam}${normSuffix}: ${p.norm_fam.toFixed(decimals)}<br>` +
            `${labels.allele2}${normSuffix}: ${p.norm_allele2.toFixed(decimals)}` +
            (normalizationApplied
              ? `<br>${t.raw} ${labels.fam}: ${p.raw_fam.toFixed(1)}<br>${t.raw} ${labels.allele2}: ${p.raw_allele2.toFixed(1)}`
              : "") +
            (p.raw_rox != null ? `<br>${normalizationLabel(labels)}: ${p.raw_rox.toFixed(1)}` : "") +
            (p.auto_cluster ? `<br>${t.chartAutoCall}: ${callLabel(p.auto_cluster, t)}` : "") +
            (p.manual_type ? `<br>${t.chartManualCall}: ${callLabel(p.manual_type, t)}` : "") +
            (p.confidence != null ? `<br>${t.confidence}: ${Math.round(p.confidence * 100)}%` : "") +
            `<br>${chartStateText(selectedWellSet.has(p.well), roxOutlierWells.includes(p.well), t)}`
          );
        }),
        hoverinfo: "text",
        hovertemplate: "%{text}<extra></extra>",
        marker: {
          size: typeKey === "NTC" ? MARKER_SIZE_NTC : MARKER_SIZE,
          color: info.color,
          symbol: info.symbol,
          opacity: info.opacity,
          line: { width: points.map(p => chartPointState(selectedWellSet.has(p.well), roxOutlierWells.includes(p.well), dark).width), color: info.stroke },
        },
      });
    }

    traces.push({
      x: [effectiveNtcCorner.fam],
      y: [effectiveNtcCorner.allele2],
      mode: "markers",
      type: "scatter",
      uid: 'ntc-threshold',
      name: t.chartNtcThreshold,
      showlegend: false,
      hovertemplate:
        `NTC: ${labels.fam} ≤ ${effectiveNtcCorner.fam.toFixed(2)}<br>` +
        `${labels.allele2} ≤ ${effectiveNtcCorner.allele2.toFixed(2)}<extra></extra>`,
      marker: {
        size: 13,
        color: "#f59e0b",
        symbol: ntcCorner ? "diamond" : "diamond-open",
        line: { width: 2, color: colors.markerLineColor },
      },
    });

    const xLabel = normalizationApplied
      ? normalizedLabel(labels.fam, labels, true)
      : `${labels.fam} (raw RFU)`;
    const yLabel = normalizationApplied
      ? normalizedLabel(labels.allele2, labels, true)
      : `${labels.allele2} (raw RFU)`;

    const axisTitleFont = { size: 14, color: colors.fontColor };

    // Radial boundary lines: ray from the RATIO ORIGIN along (r, 1-r); a fixed
    // fam-fraction r is a fixed angle about that point. Anchoring the rays at
    // (0, 0) instead would draw a fan that does not match the calls, since the
    // calls above measure their ratios from the origin. Extend each ray to the
    // data extent so it spans the plot without distorting autorange.
    let ext = 1;
    for (const p of visiblePoints) {
      ext = Math.max(ext, p.norm_fam - ratioOrigin.fam, p.norm_allele2 - ratioOrigin.allele2);
    }
    ext *= 1.05;
    const shapes: Partial<Shape>[] = bnd
      ? bnd.map((r) => {
          const tlen = ext / Math.max(r, 1 - r, 1e-6);
          return {
            type: "line",
            x0: ratioOrigin.fam,
            y0: ratioOrigin.allele2,
            x1: ratioOrigin.fam + tlen * r,
            y1: ratioOrigin.allele2 + tlen * (1 - r),
            line: { color: colors.fontColor, width: 2, dash: "dot" },
            layer: "above",
          };
        })
      : [];
    // The NTC quadrant is drawn from the VISIBLE lower-left corner, not from
    // (0, 0). Anchored at the numeric origin it was almost entirely off-canvas
    // whenever the axes were tightly autoranged (raw endpoint RFU starts near
    // 3800/2330), which is what made the quadrant unreadable and its corner
    // marker look like a stray point in the middle of the cloud.
    const bounds = visibleBounds(
      axisMode,
      dataBounds(
        visiblePoints.map((point) => ({ fam: point.norm_fam, allele2: point.norm_allele2 })),
        effectiveNtcCorner
      ),
      { xMin, xMax, yMin, yMax },
      ratioOrigin,
      ntcAxisOffsets
    );
    shapes.push(
      {
        type: "rect",
        x0: bounds.xMin,
        y0: bounds.yMin,
        x1: effectiveNtcCorner.fam,
        y1: effectiveNtcCorner.allele2,
        fillcolor: "rgba(245, 158, 11, 0.13)",
        line: { width: 0 },
        layer: "below",
      },
      {
        type: "line",
        x0: effectiveNtcCorner.fam,
        y0: bounds.yMin,
        x1: effectiveNtcCorner.fam,
        y1: bounds.yMax,
        line: { color: "#f59e0b", width: 1, dash: "dash" },
      },
      {
        type: "line",
        x0: bounds.xMin,
        y0: effectiveNtcCorner.allele2,
        x1: bounds.xMax,
        y1: effectiveNtcCorner.allele2,
        line: { color: "#f59e0b", width: 1, dash: "dash" },
      }
    );

    // Selected-well number labels (FB-12): smaller dots (above) made it hard
    // to tell on screen which point a click actually landed on, so the
    // selected well's own address is drawn next to its point -- capped at
    // MAX_WELL_LABELS so a large box/lasso selection doesn't paper the plot
    // in text. `wellPositions` looks the well up in the CURRENTLY VISIBLE
    // points, so a well hidden by a display filter (or omitted) silently
    // gets no label rather than crashing or drawing one off-plot.
    const wellPositions = new Map(visiblePoints.map((point) => [point.well, point]));
    const labeledWells = selectedWellSet.size > 0 && selectedWellSet.size <= MAX_WELL_LABELS
      ? [...selectedWellSet]
      : [];
    const annotations: NonNullable<Layout["annotations"]> = labeledWells.flatMap((well) => {
      const point = wellPositions.get(well);
      if (!point) return [];
      return [{
        x: point.norm_fam,
        y: point.norm_allele2,
        text: well,
        showarrow: false,
        yshift: 14,
        // Same tokens the legend uses (plotly-theme.ts), so the label reads
        // against both the light and dark plot background at the same
        // contrast the legend already relies on.
        font: { size: 11, color: colors.fontColor },
        bgcolor: colors.legendBg,
        bordercolor: colors.lineColor,
        borderwidth: 1,
        borderpad: 2,
      }];
    });

    const axes = axisRangeLayout(axisMode, lockAspect, bounds);
    const layout: Partial<Layout> = {
      xaxis: {
        title: { text: xLabel, font: axisTitleFont, standoff: 10 },
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        ...axes.xaxis,
      },
      yaxis: {
        title: { text: yLabel, font: axisTitleFont, standoff: 10 },
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        ...axes.yaxis,
      },
      paper_bgcolor: colors.paper_bgcolor,
      plot_bgcolor: colors.plot_bgcolor,
      font: { color: colors.fontColor },
      hovermode: "closest",
      // Keep Plotly's preserved interaction state in sync with the explicit
      // NTC-origin range and its unit basis.
      uirevision: `plate-${axisMode}-${lockAspect ? "aspect" : "free"}-${normalizationApplied ? "normalized" : "raw"}-${ntcAxisOffsets.x}-${ntcAxisOffsets.y}-${ratioOrigin.fam}-${ratioOrigin.allele2}`,
      // Box-select while selecting, zoom while editing thresholds -- and the
      // modebar below keeps both reachable either way, because picking one
      // well out of a dense cluster needs a zoom first.
      dragmode: editing ? "zoom" : "select",
      shapes,
      annotations,
      margin: { t: 10, r: 10, b: 60, l: 70 },
      legend: { orientation: "h", y: -0.2 },
    };

    const config: Partial<Config> = {
      responsive: true,
      displayModeBar: true,
      // zoom2d/pan2d are kept: with the clusters this squashed, selecting an
      // individual well is impossible without being able to zoom in first.
      modeBarButtonsToRemove: ["toImage", "sendDataToCloud"],
    };
    clearActiveChart(plotRef.current as HTMLDivElement);
    const analysis = useAnalysisStore.getState();
    const revision = analysis.result?.analysis_context?.result_revision;
    const analysedAt = analysis.result?.analysis_context?.analysed_at;
    const entry = useSessionStore.getState().entryGeneration;
    const ownerId = useAuthStore.getState().user?.id;
    const publishExport = (element: HTMLDivElement) => {
      if (token !== exportRender.current || !sessionId || !revision
        || !ownsChartResult(entry, ownerId, revision)) return;
      setActiveChart({ element, sessionId, resultRevision: revision,
        cycle: responseIdentity.cycle, useRox: responseIdentity.useRox, backgroundMode: responseIdentity.backgroundMode, entry, ownerId,
        caption: `whole-run; cycle ${responseIdentity.cycle}; ${responseIdentity.useRox ? 'reference requested' : 'raw basis'}; background ${responseIdentity.backgroundMode}; visible wells ${visiblePoints.map(point => point.well).sort().join(',')}; revision ${revision}; analysed ${analysedAt ?? 'unknown'}`,
        // A new Plotly render may alter filters, traces or layout even when the
        // underlying response has the same wells. Bind the registry record to
        // this render generation and exact visible scope so an in-flight PNG
        // cannot pass its post-encode guard against replacement pixels.
        identity: `whole-run:${sessionId}:${entry}:${revision}:${responseIdentity.cycle}:${responseIdentity.useRox}:${responseIdentity.backgroundMode}:${token}:${visiblePoints.map(point => point.well).sort().join(',')}` });
    };

    if (!initialized.current) {
      const el = plotRef.current as HTMLDivElement & Pick<PlotlyHTMLElement, "on">;
      Plotly.newPlot(el, traces, layout, config).then(() => {
        if (el !== plotRef.current) return;
        initialized.current = true;
        publishExport(el);

        // Selection modifiers, matching PlateView: ctrl/meta toggles one well
        // or unions a box into the current selection, shift unions, and a
        // plain drag replaces. The scatter can only box ONE rectangle at a
        // time and the wells an operator needs are rarely a rectangle, so
        // without this every new box threw the previous one away.
        el.on("plotly_click", (data: PlotMouseEvent) => {
          const well = textCustomdata(data?.points?.[0]?.customdata);
          if (!well) return;
          const event: MouseEvent | undefined = data.event;
          if (event?.ctrlKey || event?.metaKey) toggleWell(well);
          else if (event?.shiftKey) addWells([well]);
          else selectWell(well, "scatter");
        });

        el.on("plotly_selected", (data: PlotSelectionEvent) => {
          if (!data?.points?.length) return;
          const wells = data.points.map((p) => p.customdata).filter((well): well is string => typeof well === "string" && well.length > 0);
          if (wells.length === 0) return;
          if (additiveRef.current) addWells(wells);
          else selectWells(wells);
        });

        el.on("plotly_deselect", () => {
          // A modifier-held click is an add/remove gesture, not "throw it all
          // away" -- Plotly fires deselect for both.
          if (!additiveRef.current) clearSelection();
        });
      });
    } else {
      const element = plotRef.current;
      void Promise.resolve(Plotly.react(element, traces, layout, config)).then(() => publishExport(element));
    }
  }, [
    scatterPoints,
    allele2Dye,
    roleLabels,
    useRox,
    xMin,
    xMax,
    yMin,
    yMax,
    ntcAxisOffsets,
    showAutoCluster,
    showManualTypes,
    clusterAssignments,
    wellTypeAssignments,
    ploidy,
    linesActive,
    editBoundaries,
    offset,
    ratioOrigin,
    isWellVisible,
    visiblePoints,
    focusActive,
    selectedWellSet,
    selectWell,
    selectWells,
    addWells,
    toggleWell,
    clearSelection,
    t,
    effectiveNtcCorner,
    ntcCorner,
    axisMode,
    lockAspect,
    editing,
    normalizationApplied, roxOutlierWells,
    backgroundMode,
    sessionId,
    fetchKey,
    currentCycle,
    dark,
  ]);

  useEffect(() => () => { if (plotRef.current) clearActiveChart(plotRef.current); }, []);

  // Toggling scatterAspect only resizes the CSS-driven container (P4-S1-T1,
  // FB-04 §3-1); it changes no trace or axis data, so the main render effect
  // above deliberately does not depend on it. Plotly's own `responsive: true`
  // config already reacts to that resize in a real browser, but forcing a
  // resize here keeps the redraw deterministic instead of relying on an
  // internal observer we do not control -- and makes it exercisable in a
  // test, where no layout engine ever fires it on its own.
  useEffect(() => {
    if (!initialized.current || !plotRef.current) return;
    Plotly.Plots.resize(plotRef.current);
  }, [scatterAspect]);

  // See the `active` prop's doc comment: recover from a first draw (or a
  // resize event) that happened while ResultsPlotToggle had this view
  // hidden behind the curve view.
  useEffect(() => {
    if (!active || !initialized.current || !plotRef.current) return;
    Plotly.Plots.resize(plotRef.current);
  }, [active]);

  // Declaring the assay's dosage ceiling. Re-clusters in AUTO mode with the
  // ceiling as a constraint rather than switching to a threshold override:
  // the mixture fit is what finds the clusters, and the declaration only tells
  // it how many there can be and how high they can go.
  const handleDosageMaxApply = useCallback(
    (next: number | null) => {
      if (!sessionId) return;
      void (async () => {
        try {
          const accepted = await analyzeCurrent({
            algorithm: "auto",
            cycle: currentCycle ?? 0,
            threshold_config: {
              ntc_threshold: ntcThreshold,
              ntc_fam_max: useDataStore.getState().ntcCorner?.fam ?? null,
              ntc_allele2_max: useDataStore.getState().ntcCorner?.allele2 ?? null,
              allele1_ratio_max: 0.4,
              allele2_ratio_min: 0.6,
              // Deliberately NOT the current cuts: passing boundaries here
              // would take the threshold branch and freeze the auto rays.
              boundaries: null,
              offset: 0,
              dosage_max: next,
            },
            n_clusters: useSettingsStore.getState().nClusters,
            ploidy,
            background: backgroundMode,
            use_rox: useRox,
          });
          if (accepted) window.dispatchEvent(new CustomEvent("analysis-result-changed"));
        } catch (error) {
          console.error("Failed to persist dosage ceiling:", error);
        }
      })();
    },
    [sessionId, currentCycle, ntcThreshold, ploidy, backgroundMode, useRox]
  );

  // Highlight every selected well. Multi-selection is the normal plate-review
  // workflow, not merely an intermediate state before assigning a well type.
  useEffect(() => {
    if (!plotRef.current || !initialized.current) return;
    const el = plotRef.current as PlotlyGraphDiv;
    const data = el.data;
    if (!data || data.length === 0) return;

    for (let t = 0; t < data.length; t++) {
      if (data[t].uid === 'ntc-threshold') continue;
      const rawCustomdata = data[t].customdata;
      const customdata: unknown[] = Array.isArray(rawCustomdata) ? rawCustomdata : [];
      const sizes = customdata.map((w: unknown) => (typeof w === "string" && selectedWellSet.has(w) ? MARKER_SIZE_SELECTED : MARKER_SIZE));
      const lineWidths = customdata.map((w: unknown) => chartPointState(selectedWellSet.has(String(w)), roxOutlierWells.includes(String(w)), dark).width);
      const lineColors = chartPointState(false, false, dark).stroke;

      Plotly.restyle(plotRef.current!, {
        "marker.size": [sizes],
        "marker.line.width": [lineWidths],
        "marker.line.color": [lineColors],
      }, [t]);
    }
  }, [selectedWells, selectedWellSet, scatterPoints, roxOutlierWells, dark]);

  // Listen for dark mode changes to update Plotly layout
  useEffect(() => {
    const handler = () => {
      if (!plotRef.current || !initialized.current) return;
      const c = plotlyColors();
      Plotly.relayout(plotRef.current, {
        paper_bgcolor: c.paper_bgcolor,
        plot_bgcolor: c.plot_bgcolor,
        "font.color": c.fontColor,
        "xaxis.gridcolor": c.gridColor,
        "xaxis.zerolinecolor": c.lineColor,
        "yaxis.gridcolor": c.gridColor,
        "yaxis.zerolinecolor": c.lineColor,
      });
    };
    window.addEventListener("dark-mode-changed", handler);
    return () => window.removeEventListener("dark-mode-changed", handler);
  }, []);

  // The amber corner controls an explicit lower-left NTC quadrant. Keep live
  // dragging out of React state (and therefore out of the expensive Plotly
  // render path); commit once on release and re-run the current analysis mode.
  useEffect(() => {
    const gd = plotRef.current as PlotlyGraphDiv | null;
    // In select mode nothing of ours is installed, so Plotly receives every
    // mousedown and a selection box can be started anywhere -- including on
    // top of the amber corner marker, which sits inside the data cloud.
    if (!gd || !editing) return;
    let dragging = false;

    const clientToData = (clientX: number, clientY: number) => {
      const xa = gd._fullLayout?.xaxis;
      const ya = gd._fullLayout?.yaxis;
      if (!xa?._length || !ya?._length || !xa.range || !ya.range) return null;
      const box = gd.getBoundingClientRect();
      const px = clientX - box.left - (xa._offset ?? 0);
      const py = clientY - box.top - (ya._offset ?? 0);
      if (px < 0 || py < 0 || px > xa._length || py > ya._length) return null;
      return {
        fam: xa.range[0] + (px / xa._length) * (xa.range[1] - xa.range[0]),
        allele2: ya.range[1] - (py / ya._length) * (ya.range[1] - ya.range[0]),
      };
    };

    const onDown = (event: MouseEvent) => {
      const point = clientToData(event.clientX, event.clientY);
      const xa = gd._fullLayout?.xaxis;
      const ya = gd._fullLayout?.yaxis;
      if (!point || !xa?._length || !ya?._length || !xa.range || !ya.range) return;
      const dx = Math.abs(point.fam - ntcLiveRef.current.fam) /
        Math.abs(xa.range[1] - xa.range[0]) * xa._length;
      const dy = Math.abs(point.allele2 - ntcLiveRef.current.allele2) /
        Math.abs(ya.range[1] - ya.range[0]) * ya._length;
      if (Math.hypot(dx, dy) > 18) return;
      dragging = true;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onMove = (event: MouseEvent) => {
      if (!dragging) return;
      const point = clientToData(event.clientX, event.clientY);
      if (!point) return;
      const next = {
        fam: Math.max(0, point.fam),
        allele2: Math.max(0, point.allele2),
      };
      ntcLiveRef.current = next;
      const shapeBase = editRef.current?.length ?? 0;
      void Plotly.relayout(gd, {
        [`shapes[${shapeBase}].x1`]: next.fam,
        [`shapes[${shapeBase}].y1`]: next.allele2,
        [`shapes[${shapeBase + 1}].x0`]: next.fam,
        [`shapes[${shapeBase + 1}].x1`]: next.fam,
        [`shapes[${shapeBase + 2}].y0`]: next.allele2,
        [`shapes[${shapeBase + 2}].y1`]: next.allele2,
      });
      void Plotly.restyle(
        gd,
        { x: [[next.fam]], y: [[next.allele2]], "marker.symbol": "diamond" },
        [(gd.data?.length ?? 1) - 1]
      );
    };

    const onUp = async () => {
      if (!dragging) return;
      dragging = false;
      const next = ntcLiveRef.current;
      setNtcCorner(next);
      if (!sessionId) return;
      const cuts = linesActive ? editRef.current : null;
      try {
        const accepted = await analyzeCurrent({
          algorithm: cuts ? "threshold" : "auto",
          cycle: currentCycle ?? 0,
          threshold_config: {
            ntc_threshold: ntcThreshold,
            ntc_fam_max: next.fam,
            ntc_allele2_max: next.allele2,
            allele1_ratio_max: 0.4,
            allele2_ratio_min: 0.6,
            boundaries: cuts,
            offset: useDataStore.getState().offset,
          },
          n_clusters: useSettingsStore.getState().nClusters,
          ploidy,
          background: backgroundMode,
          use_rox: useRox,
        });
        if (accepted) window.dispatchEvent(new CustomEvent("analysis-result-changed"));
      } catch (error) {
        console.error("Failed to persist NTC quadrant:", error);
      }
    };

    gd.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      gd.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sessionId, currentCycle, ntcThreshold, ploidy, backgroundMode, useRox, linesActive, editing, setNtcCorner]);

  // Drag / add / delete the radial boundary lines (manual mode). A drag moves
  // the nearest ray; a double-click on a ray deletes it (ploidy-1), elsewhere
  // adds one (ploidy+1). Committing persists a threshold clustering with the new
  // cuts so the calls flow to every view.
  useEffect(() => {
    const gd = plotRef.current as PlotlyGraphDiv | null;
    if (!gd || !linesActive || !editing) return;

    const clientToRatio = (clientX: number, clientY: number): number | null => {
      const point = clientPoint(gd._fullLayout?.xaxis, gd._fullLayout?.yaxis, gd.getBoundingClientRect(), clientX, clientY);
      if (!point) return null;
      // Same origin the rays are drawn from, so the line follows the cursor.
      const fx = Math.max(point.x - originRef.current.fam, 0);
      const fy = Math.max(point.y - originRef.current.allele2, 0);
      const total = fx + fy;
      if (total <= 0) return null;
      return Math.max(0, Math.min(1, fx / total));
    };

    const restoreRejectedEdit = (cuts: number[]) => {
      if (editRef.current !== cuts || useAnalysisStore.getState().sessionId !== sessionId) return;
      const restored = useDataStore.getState().boundaries;
      editRef.current = restored;
      setEditBoundaries(restored);
    };

    const persist = async (cuts: number[], off: number) => {
      if (!sessionId) return;
      try {
        const accepted = await analyzeCurrent({
          algorithm: "threshold",
          cycle: currentCycle ?? 0,
          threshold_config: {
            ntc_threshold: ntcThreshold,
            ntc_fam_max: useDataStore.getState().ntcCorner?.fam ?? null,
            ntc_allele2_max: useDataStore.getState().ntcCorner?.allele2 ?? null,
            allele1_ratio_max: 0.4,
            allele2_ratio_min: 0.6,
            boundaries: cuts,
            offset: off,
          },
          n_clusters: 4,
          ploidy, // fixed organism ploidy, NOT the line count
          background: backgroundMode,
          use_rox: useRox,
        });
        if (accepted) window.dispatchEvent(new CustomEvent("analysis-result-changed"));
        else restoreRejectedEdit(cuts);
      } catch (err) {
        console.error("Failed to persist boundaries:", err);
      }
    };

    const NEAR = 0.04; // ratio tolerance for grabbing / deleting a ray

    const onDown = (e: MouseEvent) => {
      const cuts = editRef.current;
      if (!cuts) return;
      const r = clientToRatio(e.clientX, e.clientY);
      if (r == null) return;
      let best = -1;
      let bd = Infinity;
      cuts.forEach((c, i) => {
        const d = Math.abs(c - r);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0 && bd < NEAR) {
        dragIndexRef.current = best;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    const onMove = (e: MouseEvent) => {
      const idx = dragIndexRef.current;
      if (idx == null || !editRef.current) return;
      const cuts = [...editRef.current];
      const r = clientToRatio(e.clientX, e.clientY);
      if (r == null) return;
      const hi = idx > 0 ? cuts[idx - 1] - 0.002 : 0.999;
      const lo = idx < cuts.length - 1 ? cuts[idx + 1] + 0.002 : 0.001;
      cuts[idx] = Math.max(lo, Math.min(hi, r));
      editRef.current = cuts;
      setEditBoundaries(cuts);
    };

    const onUp = () => {
      if (dragIndexRef.current == null) return;
      dragIndexRef.current = null;
      if (editRef.current) persist(editRef.current, useDataStore.getState().offset);
    };

    // Double-click a ray to delete a class boundary (K-1), empty space to add one
    // (K+1). The line count is the number of OBSERVED classes minus one; ploidy
    // (the full ladder) is fixed. Adding shifts the offset down if the window
    // would otherwise run past the top dosage.
    const onDblClick = (e: MouseEvent) => {
      const r = clientToRatio(e.clientX, e.clientY);
      if (r == null) return;
      e.preventDefault();
      e.stopPropagation();
      const cuts = editRef.current ? [...editRef.current] : [];
      const curOffset = useDataStore.getState().offset;
      let near = -1;
      let bd = Infinity;
      cuts.forEach((c, i) => {
        const d = Math.abs(c - r);
        if (d < bd) {
          bd = d;
          near = i;
        }
      });
      let newOffset = curOffset;
      if (near >= 0 && bd < NEAR && cuts.length > 1) {
        cuts.splice(near, 1); // delete a class boundary (>=2 classes remain)
      } else if (cuts.length < ploidy) {
        cuts.push(r); // add a class boundary
        cuts.sort((a, b) => b - a);
        newOffset = Math.min(curOffset, ploidy - cuts.length); // keep window in range
      } else {
        return;
      }
      editRef.current = cuts;
      setEditBoundaries(cuts);
      persist(cuts, newOffset);
    };

    gd.addEventListener("mousedown", onDown, true);
    gd.addEventListener("dblclick", onDblClick, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      gd.removeEventListener("mousedown", onDown, true);
      gd.removeEventListener("dblclick", onDblClick, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [linesActive, editing, sessionId, currentCycle, ntcThreshold, ploidy, backgroundMode, useRox, setEditBoundaries]);

  // Cleanup
  useEffect(() => {
    const plot = plotRef.current;
    return () => {
      if (plot && initialized.current) {
        Plotly.purge(plot);
        initialized.current = false;
      }
    };
  }, []);

  // Overlay a status placeholder over the (always-mounted) Plotly container so
  // the plot instance persists across states and never shows as a blank void.
  const showEmpty = status === "ready" && scatterPoints.length === 0;
  const overlay =
    status === "loading" ? (
      <StatusState variant="loading" message={t.loading} />
    ) : status === "error" ? (
      <StatusState
        variant="error"
        message={t.statusLoadFailed}
        detail={fetchError ?? undefined}
        action={{ label: t.retry, onClick: () => {
          setStatus("loading");
          setFetchError(null);
          void fetchData();
        } }}
      />
    ) : showEmpty ? (
      <StatusState variant="empty" message={t.scatterEmpty} />
    ) : null;

  const controlLabels = channelLabels(
    { channel_labels: roleLabels ?? undefined },
    allele2Dye
  );
  const controlBounds = dataBounds(
    visiblePoints.map((p) => ({ fam: p.norm_fam, allele2: p.norm_allele2 })),
    effectiveNtcCorner
  );
  const originNote =
    ratioOrigin.source === "ntc"
      ? t.ratioOriginSourceNtc
      : ratioOrigin.source === "plate_floor"
      ? t.ratioOriginSourcePlateFloor
      : ratioOrigin.source === "plate_min"
      ? t.ratioOriginSourcePlateMin
      : t.ratioOriginSourceZero;

  return (
    <div className="panel scatter-panel">
      {/* P12-PLOT-TOGGLE: kept as ScatterPlot's own slim row (not threaded
          into ScatterViewControls' header) -- that header's flex-wrap row
          was already full at the 2-column 1440x1000 width, so the toggle
          just wrapped onto a new line there anyway, for the same height
          cost as its own row plus the risk of changing a shared,
          extensively-tuned component both ScatterPlot and MarkerScatterPlot
          depend on. AmplificationCurvePanel mirrors this exact row so the
          toggle sits in the same slot in both views. */}
      {viewToggle && <div className="mb-1 xl:mb-px flex justify-end">{viewToggle}</div>}
      <ScatterViewControls
        title={t.alleleDiscrimination}
        dataBounds={controlBounds}
        labels={controlLabels}
        ntcCorner={ntcCorner}
        effectiveNtcCorner={effectiveNtcCorner}
        onNtcCornerChange={setNtcCorner}
        normalizationApplied={normalizationApplied}
        roxOutlierWells={roxOutlierWells}
        hasNormalizationChannel={hasNormalizationChannel}
        ratioOrigin={{ note: originNote, fam: ratioOrigin.fam, allele2: ratioOrigin.allele2 }}
        dosageCeiling={{
          ploidy,
          applied: dosageMax,
          observedFrom: offset,
          observedClasses: (boundaries?.length ?? ploidy) + 1,
          uncertain: offsetUncertain,
          onApply: handleDosageMaxApply,
        }}
      />
      <div className="relative analysis-scatter-canvas" style={scatterAspectVars(scatterAspect)}>
        <div
          id="scatter-plot"
          data-visible-wells={visiblePoints.length}
          ref={plotRef}
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
