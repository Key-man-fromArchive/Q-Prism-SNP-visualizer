import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getScatter, runClustering } from "@/lib/api";
import { channelLabels, normalizationLabel, normalizedLabel } from "@/lib/channel-labels";
import { WELL_TYPE_INFO } from "@/lib/constants";
import { genotypeClasses, wellInfo, labelByRatio, defaultRatioCuts } from "@/lib/genotype";
import { plotlyColors } from "@/lib/plotly-theme";
import { axisRangeLayout, dataBounds, visibleBounds } from "@/lib/scatter-axes";
import { useWellFilter } from "@/hooks/use-well-filter";
import { useI18n } from "@/hooks/use-i18n";
import { StatusState } from "@/components/shared/ui";
import { ScatterViewControls } from "./ScatterViewControls";
import type { ScatterPoint } from "@/types/api";

type PlotlyAxis = { _length?: number; _offset?: number; range?: [number, number] };
type PlotlyGraphDiv = HTMLDivElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
  data?: Array<Record<string, unknown>>;
};

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

export function ScatterPlot() {
  const { t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);
  const axisMode = useSettingsStore((s) => s.axisMode);
  const lockAspect = useSettingsStore((s) => s.lockAspect);
  const scatterTool = useSettingsStore((s) => s.scatterTool);
  const xMin = useSettingsStore((s) => s.xMin);
  const xMax = useSettingsStore((s) => s.xMax);
  const yMin = useSettingsStore((s) => s.yMin);
  const yMax = useSettingsStore((s) => s.yMax);
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
  const roxOutlierWells = useDataStore((s) => s.roxOutlierWells);
  // The drag handlers are registered once per tool-open, so they read the
  // origin through a ref rather than re-binding every time it changes.
  const originRef = useRef(ratioOrigin);
  useEffect(() => {
    originRef.current = ratioOrigin;
  }, [ratioOrigin]);
  const setScatterData = useDataStore((s) => s.setScatterData);
  const boundaries = useDataStore((s) => s.boundaries);
  const setBoundaries = useDataStore((s) => s.setBoundaries);
  const offset = useDataStore((s) => s.offset);
  const setOffset = useDataStore((s) => s.setOffset);
  const ntcCorner = useDataStore((s) => s.ntcCorner);
  const setNtcCorner = useDataStore((s) => s.setNtcCorner);
  const { isWellVisible } = useWellFilter();

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
  const [editBoundaries, setEditBoundaries] = useState<number[] | null>(null);
  const editRef = useRef<number[] | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  // Sync the working copy from the stored boundaries whenever the tool opens or
  // a fresh analysis arrives (fall back to equal-spacing seeds).
  useEffect(() => {
    if (!linesActive) {
      setEditBoundaries(null);
      editRef.current = null;
      return;
    }
    const seed = boundaries && boundaries.length ? [...boundaries] : defaultRatioCuts(ploidy);
    setEditBoundaries(seed);
    editRef.current = seed;
  }, [linesActive, boundaries, ploidy]);

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
    return () => window.removeEventListener("welltypes-changed", handler);
  }, []);

  // Request lifecycle so the panel shows loading/empty/error instead of a blank
  // 560px void (PRD FR-ST-1/ST-3). `loading` covers both an in-flight fetch and
  // waiting for the cycle to initialise.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch scatter data
  const fetchData = useCallback(async () => {
    if (!sessionId || !currentCycle) {
      setStatus("loading");
      return;
    }
    setStatus((s) => (s === "ready" ? s : "loading"));
    setFetchError(null);
    try {
      const res = await getScatter(sessionId, currentCycle, useRox, backgroundMode);
      setScatterData(res.points, res.allele2_dye, res.channel_labels, res.ratio_origin, {
        applied: res.normalization_applied,
        roxOutlierWells: res.rox_outlier_wells,
      });
      setStatus("ready");
    } catch (err) {
      console.error("Failed to fetch scatter data:", err);
      setFetchError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [sessionId, currentCycle, useRox, backgroundMode, setScatterData]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refetchTrigger]);

  // Build and render traces
  useEffect(() => {
    if (!plotRef.current || scatterPoints.length === 0) return;

    // Filter to only visible wells before grouping. Omitted wells are dropped
    // entirely (by manual_type, authoritative from the backend) so they never
    // become plot markers OR influence the auto-ranged x/y axes.
    const visiblePoints = scatterPoints.filter(
      (p) =>
        p.manual_type !== "Omit" &&
        isWellVisible(p.well) &&
        (!focusActive || selectedWellSet.has(p.well))
    );

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
    const traces: any[] = [];
    const labels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);

    // Localized genotype names for the plot legend
    const typeLabels: Record<string, string> = {
      NTC: t.wellTypeNTC,
      Unknown: t.wellTypeUnknown,
      "Positive Control": t.wellTypePositiveControl,
      "Allele 1 Homo": t.wellTypeAllele1Homo,
      "Allele 2 Homo": t.wellTypeAllele2Homo,
      Heterozygous: t.wellTypeHeterozygous,
      Undetermined: t.wellTypeUndetermined,
      Empty: t.wellTypeEmpty,
      Omit: t.wellTypeOmit,
      Unassigned: t.wellTypeUnassigned,
    };

    // Build traces in a deterministic order: dosage genotype classes (for the
    // current ploidy, highest dosage first), then control/non-genotype types,
    // then unassigned. WELL_TYPE_INFO keeps only the fixed control types here;
    // the diploid genotype trio comes from genotypeClasses so ploidy drives it.
    const diploidGeno = new Set(["Allele 1 Homo", "Allele 2 Homo", "Heterozygous"]);
    const genoKeys = genotypeClasses(ploidy).map((c) => c.key);
    const controlKeys = Object.keys(WELL_TYPE_INFO).filter((k) => !diploidGeno.has(k));
    const typeOrder = [...genoKeys, ...controlKeys, "Unassigned"];
    for (const typeKey of typeOrder) {
      const points = typeGroups.get(typeKey);
      if (!points || points.length === 0) continue;

      const info = wellInfo(typeKey, ploidy);

      traces.push({
        x: points.map((p) => p.norm_fam),
        y: points.map((p) => p.norm_allele2),
        mode: "markers",
        type: "scattergl",
        name: typeLabels[typeKey] || info.label,
        customdata: points.map((p) => p.well),
        text: points.map((p) => {
          const normSuffix = normalizationApplied ? ` / ${normalizationLabel(labels)}` : "";
          return (
            `<b>${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>` +
            `${labels.fam}${normSuffix}: ${p.norm_fam.toFixed(decimals)}<br>` +
            `${labels.allele2}${normSuffix}: ${p.norm_allele2.toFixed(decimals)}` +
            (normalizationApplied
              ? `<br>Raw ${labels.fam}: ${p.raw_fam.toFixed(1)}<br>Raw ${labels.allele2}: ${p.raw_allele2.toFixed(1)}`
              : "") +
            (p.raw_rox != null ? `<br>${normalizationLabel(labels)}: ${p.raw_rox.toFixed(1)}` : "") +
            (p.auto_cluster ? `<br>Auto: ${p.auto_cluster}` : "") +
            (p.manual_type ? `<br>Manual: ${p.manual_type}` : "") +
            (p.confidence != null ? `<br>${t.confidence}: ${Math.round(p.confidence * 100)}%` : "")
          );
        }),
        hoverinfo: "text",
        hovertemplate: "%{text}<extra></extra>",
        marker: {
          size: typeKey === "NTC" ? 10 : 12,
          color: info.color,
          symbol: info.symbol,
          opacity: typeKey === "NTC" ? 1.0 : 0.8,
          line: { width: 1, color: typeKey === "NTC" ? "#000000" : colors.markerLineColor },
        },
      });
    }

    traces.push({
      x: [effectiveNtcCorner.fam],
      y: [effectiveNtcCorner.allele2],
      mode: "markers",
      type: "scatter",
      name: "NTC threshold",
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
    const shapes: Record<string, unknown>[] = bnd
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
      { xMin, xMax, yMin, yMax }
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

    const axes = axisRangeLayout(axisMode, lockAspect, bounds);
    const layout: any = {
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
      // Box-select while selecting, zoom while editing thresholds -- and the
      // modebar below keeps both reachable either way, because picking one
      // well out of a dense cluster needs a zoom first.
      dragmode: editing ? "zoom" : "select",
      shapes,
      margin: { t: 10, r: 10, b: 60, l: 70 },
      legend: { orientation: "h", y: -0.2 },
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      // zoom2d/pan2d are kept: with the clusters this squashed, selecting an
      // individual well is impossible without being able to zoom in first.
      modeBarButtonsToRemove: ["toImage", "sendDataToCloud"],
    };

    if (!initialized.current) {
      Plotly.newPlot(plotRef.current, traces, layout, config).then(() => {
        initialized.current = true;
        const el = plotRef.current as any;
        if (!el) return;

        // Selection modifiers, matching PlateView: ctrl/meta toggles one well
        // or unions a box into the current selection, shift unions, and a
        // plain drag replaces. The scatter can only box ONE rectangle at a
        // time and the wells an operator needs are rarely a rectangle, so
        // without this every new box threw the previous one away.
        el.on("plotly_click", (data: any) => {
          const well = data?.points?.[0]?.customdata;
          if (!well) return;
          const event: MouseEvent | undefined = data.event;
          if (event?.ctrlKey || event?.metaKey) toggleWell(well);
          else if (event?.shiftKey) addWells([well]);
          else selectWell(well, "scatter");
        });

        el.on("plotly_selected", (data: any) => {
          if (!data?.points?.length) return;
          const wells = data.points.map((p: any) => p.customdata).filter(Boolean);
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
      Plotly.react(plotRef.current, traces, layout, config);
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
    normalizationApplied,
  ]);

  // Highlight every selected well. Multi-selection is the normal plate-review
  // workflow, not merely an intermediate state before assigning a well type.
  useEffect(() => {
    if (!plotRef.current || !initialized.current) return;
    const el = plotRef.current as any;
    const data = el.data;
    if (!data || data.length === 0) return;

    const colors = plotlyColors();
    for (let t = 0; t < data.length; t++) {
      if (data[t].name === "NTC threshold") continue;
      const customdata = data[t].customdata || [];
      const sizes = customdata.map((w: string) => (selectedWellSet.has(w) ? 18 : 12));
      const lineWidths = customdata.map((w: string) => (selectedWellSet.has(w) ? 3 : 1));
      const lineColors = customdata.map((w: string) =>
        selectedWellSet.has(w) ? colors.selectedLineColor : colors.markerLineColor
      );

      Plotly.restyle(plotRef.current!, {
        "marker.size": [sizes],
        "marker.line.width": [lineWidths],
        "marker.line.color": [lineColors],
      }, [t]);
    }
  }, [selectedWells, selectedWellSet, scatterPoints]);

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
        const result = await runClustering(sessionId, {
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
        useDataStore.getState().setClusterAssignments(result.assignments);
        window.dispatchEvent(new CustomEvent("welltypes-changed"));
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
    const gd: any = plotRef.current;
    if (!gd || !linesActive || !editing) return;

    const clientToRatio = (clientX: number, clientY: number): number | null => {
      const fl = gd._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (!xa || !ya || !xa._length || !ya._length) return null;
      const bb = gd.getBoundingClientRect();
      const px = clientX - bb.left - xa._offset;
      const py = clientY - bb.top - ya._offset;
      if (px < 0 || py < 0 || px > xa._length || py > ya._length) return null;
      const dx = xa.range[0] + (px / xa._length) * (xa.range[1] - xa.range[0]);
      const dy = ya.range[1] - (py / ya._length) * (ya.range[1] - ya.range[0]);
      // Same origin the rays are drawn from, so the line follows the cursor.
      const fx = Math.max(dx - originRef.current.fam, 0);
      const fy = Math.max(dy - originRef.current.allele2, 0);
      const total = fx + fy;
      if (total <= 0) return null;
      return Math.max(0, Math.min(1, fx / total));
    };

    const persist = async (cuts: number[], off: number) => {
      setBoundaries(cuts);
      setOffset(off);
      if (!sessionId) return;
      try {
        await runClustering(sessionId, {
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
        window.dispatchEvent(new CustomEvent("welltypes-changed"));
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
  }, [linesActive, editing, sessionId, currentCycle, ntcThreshold, ploidy, backgroundMode, useRox, setBoundaries, setOffset]);

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
        action={{ label: t.retry, onClick: () => void fetchData() }}
      />
    ) : showEmpty ? (
      <StatusState variant="empty" message={t.scatterEmpty} />
    ) : null;

  const controlLabels = channelLabels(
    { channel_labels: roleLabels ?? undefined },
    allele2Dye
  );
  const controlBounds = dataBounds(
    scatterPoints
      .filter((p) => p.manual_type !== "Omit" && isWellVisible(p.well))
      .map((p) => ({ fam: p.norm_fam, allele2: p.norm_allele2 })),
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
      <h3 className="text-sm font-semibold mb-2 text-text">{t.alleleDiscrimination}</h3>
      <ScatterViewControls
        dataBounds={controlBounds}
        labels={controlLabels}
        ntcCorner={ntcCorner}
        effectiveNtcCorner={effectiveNtcCorner}
        onNtcCornerChange={setNtcCorner}
        normalizationApplied={normalizationApplied}
        roxOutlierWells={roxOutlierWells}
      />
      {/* Where a fam-fraction of 0.5 sits on THIS plate. Named, because the
          fallback estimate is a much weaker claim than the plate's own NTC
          wells and the operator can replace it by marking them. */}
      <p data-testid="ratio-origin-note" className="mt-1 mb-2 text-xs text-text-muted">
        {originNote} — {controlLabels.fam} {ratioOrigin.fam.toFixed(normalizationApplied ? 4 : 1)},{" "}
        {controlLabels.allele2} {ratioOrigin.allele2.toFixed(normalizationApplied ? 4 : 1)}
      </p>
      <div className="relative" style={{ height: "560px" }}>
        <div
          id="scatter-plot"
          data-visible-wells={
            focusActive
              ? scatterPoints.filter((p) => selectedWellSet.has(p.well)).length
              : scatterPoints.length
          }
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
