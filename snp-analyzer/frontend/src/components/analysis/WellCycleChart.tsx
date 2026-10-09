// P13-FE - small line chart of one well's full cycle series, shown above the
// numbers in WellDetailPanel. It plots the curve the panel already fetched
// (no request of its own).
import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout, Shape } from "plotly.js";
import { plotlyColors } from "@/lib/plotly-theme";
import type { AmplificationCurve, DataWindow } from "@/types/api";
import { plotlyText } from "@/lib/plotly-text";

type WellCycleChartProps = {
  curve: AmplificationCurve;
  famLabel: string;
  allele2Label: string;
  cycleLabel: string;
  currentCycle: number | null;
  windows: DataWindow[] | null | undefined;
  /** Changes when the surrounding disclosure opens, so a chart drawn while hidden is re-measured. */
  visibleTick: number;
};

// Tall enough for two lines, axis ticks and a legend; do not squeeze it again
// (the pre-bb7dd29 135px version was unreadable) -- the panel scrolls instead.
const CHART_HEIGHT = 180;
const WINDOW_FILLS = ["rgba(148,163,184,0.16)", "rgba(37,99,235,0.10)", "rgba(220,38,38,0.08)"];

export function WellCycleChart({ curve, famLabel, allele2Label, cycleLabel, currentCycle, windows, visibleTick }: WellCycleChartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const traces: Data[] = [
      { x: curve.cycles, y: curve.norm_fam, name: plotlyText(famLabel), mode: "lines", line: { color: "#2563eb", width: 2 } },
      { x: curve.cycles, y: curve.norm_allele2, name: plotlyText(allele2Label), mode: "lines", line: { color: "#dc2626", width: 2 } },
    ];
    const c = plotlyColors();
    const shapes: Partial<Shape>[] = (windows ?? []).map((w, i) => ({
      type: "rect", xref: "x", yref: "paper", x0: w.start_cycle, x1: w.end_cycle, y0: 0, y1: 1,
      fillcolor: WINDOW_FILLS[i % WINDOW_FILLS.length], line: { width: 0 }, layer: "below",
    }));
    const at = currentCycle == null ? -1 : curve.cycles.indexOf(currentCycle);
    if (currentCycle != null) {
      shapes.push({ type: "line", x0: currentCycle, x1: currentCycle, y0: 0, y1: 1, yref: "paper", line: { color: "#9ca3af", width: 1, dash: "dot" } });
    }
    if (at >= 0) {
      traces.push(
        { x: [currentCycle], y: [curve.norm_fam[at]], mode: "markers", showlegend: false, hoverinfo: "skip", marker: { color: "#2563eb", size: 7 } },
        { x: [currentCycle], y: [curve.norm_allele2[at]], mode: "markers", showlegend: false, hoverinfo: "skip", marker: { color: "#dc2626", size: 7 } },
      );
    }
    const layout: Partial<Layout> = {
      xaxis: { title: { text: plotlyText(cycleLabel), standoff: 4 }, gridcolor: c.gridColor, automargin: true },
      yaxis: { gridcolor: c.gridColor, automargin: true },
      paper_bgcolor: c.paper_bgcolor,
      plot_bgcolor: c.plot_bgcolor,
      font: { color: c.fontColor, size: 10 },
      margin: { t: 6, r: 8, b: 36, l: 40 },
      legend: { orientation: "h", x: 1, xanchor: "right", y: 1, yanchor: "bottom", bgcolor: c.legendBg },
      shapes,
    };
    void Plotly.react(node, traces, layout, { responsive: true, displayModeBar: false });
    // Drawn while the details disclosure was closed: width was 0, re-measure.
    if (visibleTick > 0) Plotly.Plots.resize(node);
  }, [curve, famLabel, allele2Label, cycleLabel, currentCycle, windows, visibleTick]);

  useEffect(() => {
    const node = ref.current;
    return () => { if (node) Plotly.purge(node); };
  }, []);

  return <div data-testid="well-timeseries-plot" ref={ref} style={{ width: "100%", height: `${CHART_HEIGHT}px` }} />;
}
