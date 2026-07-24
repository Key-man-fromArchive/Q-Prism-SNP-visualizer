import { useRef, useEffect, useCallback, useState } from "react";
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
import { useWellFilter } from "@/hooks/use-well-filter";
import { useI18n } from "@/hooks/use-i18n";
import { StatusState } from "@/components/shared/ui";
import type { ScatterPoint } from "@/types/api";

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
  const { useRox, fixAxis, xMin, xMax, yMin, yMax, showAutoCluster, showManualTypes } =
    useSettingsStore();
  const ploidy = useSettingsStore((s) => s.ploidy);
  const ntcThreshold = useSettingsStore((s) => s.ntcThreshold);
  const showBoundaryLines = useSettingsStore((s) => s.showBoundaryLines);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const { selectWell, selectWells, clearSelection, selectedWell } = useSelectionStore();
  const { scatterPoints, allele2Dye, channelLabels: roleLabels, clusterAssignments, wellTypeAssignments } = useDataStore();
  const setScatterData = useDataStore((s) => s.setScatterData);
  const boundaries = useDataStore((s) => s.boundaries);
  const setBoundaries = useDataStore((s) => s.setBoundaries);
  const offset = useDataStore((s) => s.offset);
  const setOffset = useDataStore((s) => s.setOffset);
  const { isWellVisible } = useWellFilter();

  // Draggable radial genotype-boundary lines (manual mode). Rendered only when
  // manual types are active AND the boundary toggle is on. The number of lines
  // equals the ploidy (P lines -> P+1 dosage wedges); adding/deleting a line
  // changes the ploidy in lockstep so selector, lines and classes stay in sync.
  const linesActive = showManualTypes && showBoundaryLines;
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
      const res = await getScatter(sessionId, currentCycle, useRox);
      setScatterData(res.points, res.allele2_dye, res.channel_labels);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to fetch scatter data:", err);
      setFetchError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [sessionId, currentCycle, useRox, setScatterData]);

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
      (p) => p.manual_type !== "Omit" && isWellVisible(p.well)
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
      const total = point.norm_fam + point.norm_allele2;
      if (total <= 0) return "Unassigned";
      return labelByRatio(point.norm_fam / total, ploidy, bnd!, offset);
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
    const decimals = useRox ? 4 : 1;
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
          const normSuffix = useRox ? ` / ${normalizationLabel(labels)}` : "";
          return (
            `<b>${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>` +
            `${labels.fam}${normSuffix}: ${p.norm_fam.toFixed(decimals)}<br>` +
            `${labels.allele2}${normSuffix}: ${p.norm_allele2.toFixed(decimals)}` +
            (useRox
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

    const xLabel = useRox ? normalizedLabel(labels.fam, labels, true) : `${labels.fam} (raw RFU)`;
    const yLabel = useRox ? normalizedLabel(labels.allele2, labels, true) : `${labels.allele2} (raw RFU)`;

    const axisTitleFont = { size: 14, color: colors.fontColor };

    // Radial boundary lines: ray from the origin along (r, 1-r); a fixed
    // fam-fraction r is a fixed angle. Extend each ray to the data extent so it
    // spans the plot without distorting autorange.
    let ext = 1;
    for (const p of visiblePoints) ext = Math.max(ext, p.norm_fam, p.norm_allele2);
    ext *= 1.05;
    const shapes = bnd
      ? bnd.map((r) => {
          const tlen = ext / Math.max(r, 1 - r, 1e-6);
          return {
            type: "line",
            x0: 0,
            y0: 0,
            x1: tlen * r,
            y1: tlen * (1 - r),
            line: { color: colors.fontColor, width: 2, dash: "dot" },
            layer: "above",
          };
        })
      : [];

    const layout: any = {
      xaxis: {
        title: { text: xLabel, font: axisTitleFont, standoff: 10 },
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        ...(fixAxis ? { range: [xMin, xMax] } : { autorange: true }),
      },
      yaxis: {
        title: { text: yLabel, font: axisTitleFont, standoff: 10 },
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        ...(fixAxis ? { range: [yMin, yMax] } : { autorange: true }),
      },
      paper_bgcolor: colors.paper_bgcolor,
      plot_bgcolor: colors.plot_bgcolor,
      font: { color: colors.fontColor },
      hovermode: "closest",
      // Disable box-select while editing boundary lines so drags move the rays.
      dragmode: linesActive ? false : "select",
      shapes,
      margin: { t: 10, r: 10, b: 60, l: 70 },
      legend: { orientation: "h", y: -0.2 },
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ["toImage", "sendDataToCloud", "zoom2d", "pan2d"],
    };

    if (!initialized.current) {
      Plotly.newPlot(plotRef.current, traces, layout, config).then(() => {
        initialized.current = true;
        const el = plotRef.current as any;
        if (!el) return;

        el.on("plotly_click", (data: any) => {
          if (data.points?.length > 0) {
            const well = data.points[0].customdata;
            if (well) selectWell(well, "scatter");
          }
        });

        el.on("plotly_selected", (data: any) => {
          if (data?.points?.length > 0) {
            const wells = data.points
              .map((p: any) => p.customdata)
              .filter(Boolean);
            if (wells.length > 0) selectWells(wells);
          }
        });

        el.on("plotly_deselect", () => {
          clearSelection();
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
    fixAxis,
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
    isWellVisible,
    selectWell,
    selectWells,
    clearSelection,
    t,
  ]);

  // Highlight selected well
  useEffect(() => {
    if (!plotRef.current || !initialized.current) return;
    const el = plotRef.current as any;
    const data = el.data;
    if (!data || data.length === 0) return;

    const colors = plotlyColors();
    for (let t = 0; t < data.length; t++) {
      const customdata = data[t].customdata || [];
      const sizes = customdata.map((w: string) => (w === selectedWell ? 18 : 12));
      const lineWidths = customdata.map((w: string) => (w === selectedWell ? 3 : 1));
      const lineColors = customdata.map((w: string) =>
        w === selectedWell ? colors.selectedLineColor : colors.markerLineColor
      );

      Plotly.restyle(plotRef.current!, {
        "marker.size": [sizes],
        "marker.line.width": [lineWidths],
        "marker.line.color": [lineColors],
      }, [t]);
    }
  }, [selectedWell, scatterPoints]);

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

  // Drag / add / delete the radial boundary lines (manual mode). A drag moves
  // the nearest ray; a double-click on a ray deletes it (ploidy-1), elsewhere
  // adds one (ploidy+1). Committing persists a threshold clustering with the new
  // cuts so the calls flow to every view.
  useEffect(() => {
    const gd: any = plotRef.current;
    if (!gd || !linesActive) return;

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
      const total = dx + dy;
      if (total <= 0) return null;
      return Math.max(0, Math.min(1, dx / total));
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
            allele1_ratio_max: 0.4,
            allele2_ratio_min: 0.6,
            boundaries: cuts,
            offset: off,
          },
          n_clusters: 4,
          ploidy, // fixed organism ploidy, NOT the line count
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
        e.stopPropagation();
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
  }, [linesActive, sessionId, currentCycle, ntcThreshold, ploidy, setBoundaries, setOffset]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (plotRef.current && initialized.current) {
        Plotly.purge(plotRef.current);
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

  return (
    <div className="panel scatter-panel">
      <h3 className="text-sm font-semibold mb-2 text-text">{t.alleleDiscrimination}</h3>
      <div className="relative" style={{ height: "560px" }}>
        <div id="scatter-plot" ref={plotRef} style={{ width: "100%", height: "100%" }} />
        {overlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            {overlay}
          </div>
        )}
      </div>
    </div>
  );
}
