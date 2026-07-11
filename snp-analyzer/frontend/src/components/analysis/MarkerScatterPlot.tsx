// @TASK P4-S2 - Per-marker scatter (dosage-colored, draggable radial boundaries)
// @SPEC docs/multi-marker-ux-decision.md §1 Q5, §3 (ploidy risk field)
// @TEST e2e/p4-s2-analysis-tab.spec.ts
//
// Sibling of ScatterPlot.tsx, reusing the same rendering/drag approach
// (Plotly scattergl + radial dashed boundary rays, drag-to-move) but scoped
// to ONE marker's wells/ploidy/assignments instead of the whole-plate
// global stores. ScatterPlot.tsx itself is left untouched (still used by
// the single-marker default view) to avoid regressing S0/S1.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { dosageOfLabel, defaultRatioCuts, wellInfo } from "@/lib/genotype";
import { plotlyColors } from "@/lib/plotly-theme";
import { channelLabels } from "@/lib/channel-labels";
import { updateMarker } from "@/lib/api";
import type { ChannelLabels, MarkerRegion, RegionResult, ScatterPoint } from "@/types/api";

// Plotly's own module typings (src/plotly.d.ts) are untyped (`any`); this
// narrow shape covers only the internal fields this component reads off a
// mounted graph div (axis pixel geometry for the drag math) without
// widening to `any` at every call site.
type PlotlyAxis = { _length?: number; _offset?: number; range?: [number, number] };
type PlotlyGraphDiv = HTMLDivElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
};

type MarkerScatterPlotProps = {
  sessionId: string;
  marker: MarkerRegion;
  region: RegionResult | undefined;
  points: ScatterPoint[]; // whole-plate scatter points (filtered internally to marker.wells)
  allele2Dye?: string | null;
  roleLabels?: ChannelLabels | null;
  onBoundariesPersisted: () => void | Promise<void>;
};

export function MarkerScatterPlot({
  sessionId,
  marker,
  region,
  points,
  allele2Dye,
  roleLabels,
  onBoundariesPersisted,
}: MarkerScatterPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const ploidy = marker.ploidy;
  const wellSet = useMemo(() => new Set(marker.wells), [marker.wells]);
  const scopedPoints = useMemo(
    () => points.filter((p) => wellSet.has(p.well)),
    [points, wellSet]
  );

  // Seeded once from the marker's current region result (boundaries/offset),
  // falling back to equal-spacing cuts when there's no prior result yet. The
  // parent mounts this component with `key={marker.id}` so switching markers
  // (or a fresh region arriving after this marker's own drag is persisted +
  // re-clustered) always seeds from a clean, up-to-date `region` instead of
  // needing an effect to re-seed an existing instance in place.
  const [editBoundaries, setEditBoundaries] = useState<number[]>(() =>
    region?.boundaries && region.boundaries.length
      ? [...region.boundaries]
      : defaultRatioCuts(ploidy)
  );
  const editRef = useRef<number[]>(editBoundaries);
  const dragIndexRef = useRef<number | null>(null);
  const offsetRef = useRef<number>(region?.offset ?? 0);

  const assignmentFor = useCallback(
    (well: string): string | null => region?.assignments?.[well] ?? null,
    [region]
  );

  useEffect(() => {
    if (!plotRef.current) return;

    const typeGroups = new Map<string, ScatterPoint[]>();
    for (const p of scopedPoints) {
      const type = assignmentFor(p.well) || "Unassigned";
      if (!typeGroups.has(type)) typeGroups.set(type, []);
      typeGroups.get(type)!.push(p);
    }

    // Order: dosage classes highest-dosage first, then anything else, then Unassigned.
    const order = [...typeGroups.keys()].sort((a, b) => {
      const da = dosageOfLabel(a, ploidy);
      const db = dosageOfLabel(b, ploidy);
      if (da !== null && db !== null) return db - da;
      if (da !== null) return -1;
      if (db !== null) return 1;
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });

    const colors = plotlyColors();
    const traces: Record<string, unknown>[] = [];
    for (const typeKey of order) {
      const pts = typeGroups.get(typeKey)!;
      const info = wellInfo(typeKey, ploidy);
      traces.push({
        x: pts.map((p) => p.norm_fam),
        y: pts.map((p) => p.norm_allele2),
        mode: "markers",
        type: "scattergl",
        name: info.label,
        customdata: pts.map((p) => p.well),
        text: pts.map(
          (p) =>
            `<b>${p.well}</b>${p.sample_name ? " (" + p.sample_name + ")" : ""}<br>` +
            `${info.label}`
        ),
        hoverinfo: "text",
        hovertemplate: "%{text}<extra></extra>",
        marker: {
          size: typeKey === "NTC" ? 9 : 11,
          color: info.color,
          symbol: info.symbol,
          opacity: typeKey === "NTC" ? 1.0 : 0.85,
          line: { width: 1, color: colors.markerLineColor },
        },
      });
    }

    let ext = 1;
    for (const p of scopedPoints) ext = Math.max(ext, p.norm_fam, p.norm_allele2);
    ext *= 1.05;
    const cuts = editRef.current;
    const shapes = cuts.map((r) => {
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
    });

    const labels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);
    const layout: Record<string, unknown> = {
      xaxis: {
        title: { text: labels.fam, font: { size: 12, color: colors.fontColor } },
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        autorange: true,
      },
      yaxis: {
        title: { text: labels.allele2, font: { size: 12, color: colors.fontColor } },
        gridcolor: colors.gridColor,
        zerolinecolor: colors.lineColor,
        autorange: true,
      },
      paper_bgcolor: colors.paper_bgcolor,
      plot_bgcolor: colors.plot_bgcolor,
      font: { color: colors.fontColor },
      hovermode: "closest",
      dragmode: false,
      shapes,
      margin: { t: 10, r: 10, b: 46, l: 56 },
      legend: { orientation: "h", y: -0.2 },
    };

    const config = {
      responsive: true,
      displayModeBar: false,
    };

    if (!initialized.current) {
      Plotly.newPlot(plotRef.current, traces, layout, config).then(() => {
        initialized.current = true;
      });
    } else {
      Plotly.react(plotRef.current, traces, layout, config);
    }
  }, [scopedPoints, assignmentFor, ploidy, editBoundaries, allele2Dye, roleLabels]);

  // Drag a radial boundary line; persists to the marker's threshold_config on
  // release (PUT /markers/{id}) then asks the parent to re-cluster so the
  // override is reflected everywhere (and survives tab-switch/re-cluster --
  // the backend treats a marker's threshold_config.boundaries as authoritative).
  useEffect(() => {
    const gd = plotRef.current as PlotlyGraphDiv | null;
    if (!gd) return;

    const clientToRatio = (clientX: number, clientY: number): number | null => {
      const fl = gd._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (!xa || !ya || !xa._length || !ya._length || !xa.range || !ya.range) return null;
      const bb = gd.getBoundingClientRect();
      const px = clientX - bb.left - (xa._offset ?? 0);
      const py = clientY - bb.top - (ya._offset ?? 0);
      if (px < 0 || py < 0 || px > xa._length || py > ya._length) return null;
      const dx = xa.range[0] + (px / xa._length) * (xa.range[1] - xa.range[0]);
      const dy = ya.range[1] - (py / ya._length) * (ya.range[1] - ya.range[0]);
      const total = dx + dy;
      if (total <= 0) return null;
      return Math.max(0, Math.min(1, dx / total));
    };

    const persist = async (cuts: number[]) => {
      try {
        await updateMarker(sessionId, marker.id, {
          threshold_config: {
            ntc_threshold: 0.1,
            allele1_ratio_max: 0.4,
            allele2_ratio_min: 0.6,
            boundaries: cuts,
            offset: offsetRef.current,
          },
        });
        await onBoundariesPersisted();
      } catch (err) {
        console.error("Failed to persist marker boundaries:", err);
      }
    };

    const NEAR = 0.04;

    const onDown = (e: MouseEvent) => {
      const cuts = editRef.current;
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
      if (idx == null) return;
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
      persist(editRef.current);
    };

    gd.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      gd.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sessionId, marker.id, onBoundariesPersisted]);

  useEffect(() => {
    return () => {
      if (plotRef.current && initialized.current) {
        Plotly.purge(plotRef.current);
        initialized.current = false;
      }
    };
  }, []);

  return (
    <div data-testid="marker-scatter" ref={plotRef} style={{ width: "100%", height: "440px" }} />
  );
}
