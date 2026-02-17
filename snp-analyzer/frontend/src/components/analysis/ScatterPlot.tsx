import { useRef, useEffect, useCallback } from "react";
import Plotly from "plotly.js-dist-min";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useDataStore } from "@/stores/data-store";
import { getScatter } from "@/lib/api";
import { WELL_TYPE_INFO, UNASSIGNED_TYPE } from "@/lib/constants";
import { plotlyColors } from "@/lib/plotly-theme";
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
  const plotRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const sessionId = useSessionStore((s) => s.sessionId);
  const { useRox, fixAxis, xMin, xMax, yMin, yMax, showAutoCluster, showManualTypes } =
    useSettingsStore();
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const { selectWell, selectWells, clearSelection, selectedWell } = useSelectionStore();
  const { scatterPoints, allele2Dye, clusterAssignments, wellTypeAssignments } = useDataStore();
  const setScatterData = useDataStore((s) => s.setScatterData);

  // Fetch scatter data
  const fetchData = useCallback(async () => {
    if (!sessionId || !currentCycle) return;
    try {
      const res = await getScatter(sessionId, currentCycle, useRox);
      setScatterData(res.points, res.allele2_dye);
    } catch (err) {
      console.error("Failed to fetch scatter data:", err);
    }
  }, [sessionId, currentCycle, useRox, setScatterData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build and render traces
  useEffect(() => {
    if (!plotRef.current || scatterPoints.length === 0) return;

    // Group points by effective type
    const typeGroups = new Map<string, ScatterPoint[]>();
    for (const point of scatterPoints) {
      const type =
        effectiveType(point.auto_cluster, point.manual_type, showAutoCluster, showManualTypes) ||
        "Unassigned";
      if (!typeGroups.has(type)) typeGroups.set(type, []);
      typeGroups.get(type)!.push(point);
    }

    const colors = plotlyColors();
    const decimals = useRox ? 4 : 1;
    const traces: any[] = [];

    // Build traces in a deterministic order
    const typeOrder = [...Object.keys(WELL_TYPE_INFO), "Unassigned"];
    for (const typeKey of typeOrder) {
      const points = typeGroups.get(typeKey);
      if (!points || points.length === 0) continue;

      const info =
        WELL_TYPE_INFO[typeKey as keyof typeof WELL_TYPE_INFO] || UNASSIGNED_TYPE;

      traces.push({
        x: points.map((p) => p.norm_fam),
        y: points.map((p) => p.norm_allele2),
        mode: "markers",
        type: "scattergl",
        name: info.label,
        customdata: points.map((p) => p.well),
        text: points.map((p) => {
          const normLabel = useRox ? "/ROX" : "";
          return (
            `<b>${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>` +
            `FAM${normLabel}: ${p.norm_fam.toFixed(decimals)}<br>` +
            `${allele2Dye}${normLabel}: ${p.norm_allele2.toFixed(decimals)}` +
            (useRox
              ? `<br>Raw FAM: ${p.raw_fam.toFixed(1)}<br>Raw ${allele2Dye}: ${p.raw_allele2.toFixed(1)}`
              : "") +
            (p.raw_rox != null ? `<br>ROX: ${p.raw_rox.toFixed(1)}` : "") +
            (p.auto_cluster ? `<br>Auto: ${p.auto_cluster}` : "") +
            (p.manual_type ? `<br>Manual: ${p.manual_type}` : "")
          );
        }),
        hoverinfo: "text",
        hovertemplate: "%{text}<extra></extra>",
        marker: {
          size: 12,
          color: info.color,
          symbol: info.symbol,
          opacity: 0.8,
          line: { width: 1, color: colors.markerLineColor },
        },
      });
    }

    const xLabel = useRox ? "FAM / ROX" : "FAM (raw RFU)";
    const yLabel = useRox ? `${allele2Dye} / ROX` : `${allele2Dye} (raw RFU)`;

    const layout: any = {
      xaxis: {
        title: xLabel,
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        ...(fixAxis ? { range: [xMin, xMax] } : { autorange: true }),
      },
      yaxis: {
        title: yLabel,
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        ...(fixAxis ? { range: [yMin, yMax] } : { autorange: true }),
      },
      paper_bgcolor: colors.paper_bgcolor,
      plot_bgcolor: colors.plot_bgcolor,
      font: { color: colors.fontColor },
      hovermode: "closest",
      dragmode: "select",
      margin: { t: 10, r: 10, b: 50, l: 60 },
      legend: { orientation: "h", y: -0.15 },
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
    selectWell,
    selectWells,
    clearSelection,
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (plotRef.current && initialized.current) {
        Plotly.purge(plotRef.current);
        initialized.current = false;
      }
    };
  }, []);

  return (
    <div className="panel scatter-panel">
      <h3 className="text-sm font-semibold mb-2 text-text">Allele Discrimination</h3>
      <div id="scatter-plot" ref={plotRef} style={{ width: "100%", height: "400px" }} />
    </div>
  );
}
