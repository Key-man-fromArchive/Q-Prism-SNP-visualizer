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
import { ZERO_ORIGIN } from "@/stores/data-store";
import { useSelectionStore } from "@/stores/selection-store";
import type {
  ChannelLabels,
  MarkerRegion,
  RatioOrigin,
  RegionResult,
  ScatterPoint,
} from "@/types/api";

// Plotly's own module typings (src/plotly.d.ts) are untyped (`any`); this
// narrow shape covers only the internal fields this component reads off a
// mounted graph div (axis pixel geometry for the drag math) without
// widening to `any` at every call site.
type PlotlyAxis = { _length?: number; _offset?: number; range?: [number, number] };
type PlotlyGraphDiv = HTMLDivElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
  data?: unknown[];
};

type MarkerScatterPlotProps = {
  sessionId: string;
  marker: MarkerRegion;
  region: RegionResult | undefined;
  points: ScatterPoint[]; // whole-plate scatter points (filtered internally to marker.wells)
  // Origin the boundary rays and the drag math measure their fam-fraction
  // from. The points are raw RFU, so on endpoint data this is not (0, 0) --
  // see app/processing/ratio_origin.py.
  ratioOrigin?: RatioOrigin | null;
  allele2Dye?: string | null;
  roleLabels?: ChannelLabels | null;
  onBoundariesPersisted: () => void | Promise<void>;
};

export function MarkerScatterPlot({
  sessionId,
  marker,
  region,
  points,
  ratioOrigin,
  allele2Dye,
  roleLabels,
  onBoundariesPersisted,
}: MarkerScatterPlotProps) {
  const origin = ratioOrigin ?? ZERO_ORIGIN;
  const originRef = useRef(origin);
  useEffect(() => {
    originRef.current = origin;
  }, [origin]);
  const plotRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const eventsBound = useRef(false);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const focusSelectedWells = useSelectionStore((s) => s.focusSelectedWells);
  const selectWell = useSelectionStore((s) => s.selectWell);
  const selectWells = useSelectionStore((s) => s.selectWells);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectedWellSet = useMemo(() => new Set(selectedWells), [selectedWells]);

  const ploidy = marker.ploidy;
  const wellSet = useMemo(() => new Set(marker.wells), [marker.wells]);
  const scopedPoints = useMemo(() => {
    const markerPoints = points.filter((p) => wellSet.has(p.well));
    return focusSelectedWells
      ? markerPoints.filter((p) => selectedWellSet.has(p.well))
      : markerPoints;
  }, [points, wellSet, focusSelectedWells, selectedWellSet]);
  const assignmentFor = useCallback(
    (well: string): string | null => region?.assignments?.[well] ?? null,
    [region]
  );

  // Keep the Plotly instance mounted across marker switches. Boundary edits
  // are keyed by the marker/result signature, so a new marker starts from its
  // own saved cuts without forcing a costly Plotly purge/newPlot cycle.
  const boundarySeed = useMemo(
    () =>
      region?.boundaries && region.boundaries.length
        ? [...region.boundaries]
        : defaultRatioCuts(ploidy),
    [region, ploidy]
  );
  const boundaryKey = `${marker.id}:${region?.boundaries?.join(",") ?? "default"}:${region?.offset ?? 0}`;
  const [boundaryEdit, setBoundaryEdit] = useState(() => ({
    key: boundaryKey,
    cuts: boundarySeed,
  }));
  const editBoundaries = boundaryEdit.key === boundaryKey ? boundaryEdit.cuts : boundarySeed;
  const editRef = useRef<number[]>(editBoundaries);
  const dragIndexRef = useRef<number | null>(null);
  const dragNtcRef = useRef(false);
  const offsetRef = useRef<number>(region?.offset ?? 0);

  const ntcSeed = useMemo(() => {
    const savedX = marker.threshold_config?.ntc_fam_max;
    const savedY = marker.threshold_config?.ntc_allele2_max;
    if (savedX != null && savedY != null) return { x: savedX, y: savedY };

    const markerPoints = points.filter((p) => wellSet.has(p.well));
    const ntcPoints = markerPoints.filter((p) => assignmentFor(p.well) === "NTC");
    const maxX = Math.max(1, ...markerPoints.map((p) => p.norm_fam));
    const maxY = Math.max(1, ...markerPoints.map((p) => p.norm_allele2));
    if (ntcPoints.length > 0) {
      return {
        x: Math.max(...ntcPoints.map((p) => p.norm_fam)) + maxX * 0.02,
        y: Math.max(...ntcPoints.map((p) => p.norm_allele2)) + maxY * 0.02,
      };
    }
    return {
      x: origin.fam + maxX * 0.08,
      y: origin.allele2 + maxY * 0.08,
    };
  }, [marker.threshold_config, points, wellSet, assignmentFor, origin]);
  const ntcKey = `${marker.id}:${marker.threshold_config?.ntc_fam_max ?? "auto"}:${marker.threshold_config?.ntc_allele2_max ?? "auto"}`;
  const [ntcEdit, setNtcEdit] = useState(() => ({
    key: ntcKey,
    corner: ntcSeed,
    enabled:
      marker.threshold_config?.ntc_fam_max != null &&
      marker.threshold_config?.ntc_allele2_max != null,
  }));
  const effectiveNtc = useMemo(
    () =>
      ntcEdit.key === ntcKey
        ? ntcEdit
        : {
            key: ntcKey,
            corner: ntcSeed,
            enabled:
              marker.threshold_config?.ntc_fam_max != null &&
              marker.threshold_config?.ntc_allele2_max != null,
          },
    [ntcEdit, ntcKey, ntcSeed, marker.threshold_config]
  );
  const ntcRef = useRef(effectiveNtc);

  useEffect(() => {
    editRef.current = editBoundaries;
    offsetRef.current = region?.offset ?? 0;
  }, [editBoundaries, region?.offset]);

  useEffect(() => {
    ntcRef.current = effectiveNtc;
  }, [effectiveNtc]);

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
          size: pts.map((p) =>
            selectedWellSet.has(p.well) ? 17 : typeKey === "NTC" ? 9 : 11
          ),
          color: info.color,
          symbol: info.symbol,
          opacity: typeKey === "NTC" ? 1.0 : 0.85,
          line: {
            width: pts.map((p) => (selectedWellSet.has(p.well) ? 3 : 1)),
            color: pts.map((p) =>
              selectedWellSet.has(p.well)
                ? colors.selectedLineColor
                : colors.markerLineColor
            ),
          },
        },
      });
    }

    traces.push({
      x: [effectiveNtc.corner.x],
      y: [effectiveNtc.corner.y],
      mode: "markers",
      type: "scatter",
      name: "NTC threshold",
      showlegend: false,
      hovertemplate:
        `NTC: FAM ≤ ${effectiveNtc.corner.x.toFixed(2)}<br>` +
        `${allele2Dye || "Allele 2"} ≤ ${effectiveNtc.corner.y.toFixed(2)}<extra></extra>`,
      marker: {
        size: 13,
        color: "#f59e0b",
        symbol: effectiveNtc.enabled ? "diamond" : "diamond-open",
        line: { width: 2, color: colors.markerLineColor },
      },
    });

    let ext = 1;
    for (const p of scopedPoints) {
      ext = Math.max(ext, p.norm_fam - origin.fam, p.norm_allele2 - origin.allele2);
    }
    ext *= 1.05;
    const cuts = editRef.current;
    const shapes: Record<string, unknown>[] = cuts.map((r) => {
      const tlen = ext / Math.max(r, 1 - r, 1e-6);
      return {
        type: "line",
        x0: origin.fam,
        y0: origin.allele2,
        x1: origin.fam + tlen * r,
        y1: origin.allele2 + tlen * (1 - r),
        line: { color: colors.fontColor, width: 2, dash: "dot" },
        layer: "above",
      };
    });
    const axisMaxX = Math.max(
      effectiveNtc.corner.x * 1.1,
      ...scopedPoints.map((p) => p.norm_fam * 1.05),
      1
    );
    const axisMaxY = Math.max(
      effectiveNtc.corner.y * 1.1,
      ...scopedPoints.map((p) => p.norm_allele2 * 1.05),
      1
    );
    shapes.push(
      {
        type: "rect",
        x0: 0,
        y0: 0,
        x1: effectiveNtc.corner.x,
        y1: effectiveNtc.corner.y,
        fillcolor: "rgba(245, 158, 11, 0.13)",
        line: { width: 0 },
        layer: "below",
      },
      {
        type: "line",
        x0: effectiveNtc.corner.x,
        y0: 0,
        x1: effectiveNtc.corner.x,
        y1: axisMaxY,
        line: { color: "#f59e0b", width: 2, dash: "dash" },
      },
      {
        type: "line",
        x0: 0,
        y0: effectiveNtc.corner.y,
        x1: axisMaxX,
        y1: effectiveNtc.corner.y,
        line: { color: "#f59e0b", width: 2, dash: "dash" },
      }
    );

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
      dragmode: "select",
      uirevision: `marker-${marker.id}`,
      shapes,
      margin: { t: 10, r: 10, b: 46, l: 56 },
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
        const gd = plotRef.current as PlotlyGraphDiv & {
          on?: (name: string, handler: (data?: { points?: Array<{ customdata?: string }> }) => void) => void;
        };
        if (!gd || !gd.on || eventsBound.current) return;
        eventsBound.current = true;
        gd.on("plotly_click", (data) => {
          const well = data?.points?.[0]?.customdata;
          if (well) selectWell(well, "scatter");
        });
        gd.on("plotly_selected", (data) => {
          const wells = data?.points?.map((p) => p.customdata).filter((w): w is string => !!w) ?? [];
          if (wells.length > 0) selectWells(wells);
        });
        gd.on("plotly_deselect", () => clearSelection());
      });
    } else {
      Plotly.react(plotRef.current, traces, layout, config);
    }
  }, [
    scopedPoints,
    assignmentFor,
    ploidy,
    editBoundaries,
    origin,
    allele2Dye,
    roleLabels,
    marker.id,
    selectedWellSet,
    effectiveNtc,
    selectWell,
    selectWells,
    clearSelection,
  ]);

  // Drag a radial boundary line; persists to the marker's threshold_config on
  // release (PUT /markers/{id}) then asks the parent to re-cluster so the
  // override is reflected everywhere (and survives tab-switch/re-cluster --
  // the backend treats a marker's threshold_config.boundaries as authoritative).
  useEffect(() => {
    const gd = plotRef.current as PlotlyGraphDiv | null;
    if (!gd) return;

    const clientToData = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const fl = gd._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (!xa || !ya || !xa._length || !ya._length || !xa.range || !ya.range) return null;
      const bb = gd.getBoundingClientRect();
      const px = clientX - bb.left - (xa._offset ?? 0);
      const py = clientY - bb.top - (ya._offset ?? 0);
      if (px < 0 || py < 0 || px > xa._length || py > ya._length) return null;
      return {
        x: xa.range[0] + (px / xa._length) * (xa.range[1] - xa.range[0]),
        y: ya.range[1] - (py / ya._length) * (ya.range[1] - ya.range[0]),
      };
    };

    const clientToRatio = (clientX: number, clientY: number): number | null => {
      const data = clientToData(clientX, clientY);
      if (!data) return null;
      // Same origin the rays are anchored at, so the line follows the cursor.
      const fx = Math.max(data.x - originRef.current.fam, 0);
      const fy = Math.max(data.y - originRef.current.allele2, 0);
      const total = fx + fy;
      if (total <= 0) return null;
      return Math.max(0, Math.min(1, fx / total));
    };

    const persist = async (ntcOnly: boolean) => {
      try {
        const ntc = ntcRef.current;
        const current = marker.threshold_config;
        await updateMarker(sessionId, marker.id, {
          threshold_config: {
            ntc_threshold: current?.ntc_threshold ?? 0.1,
            ntc_fam_max: ntc.enabled ? ntc.corner.x : null,
            ntc_allele2_max: ntc.enabled ? ntc.corner.y : null,
            allele1_ratio_max: current?.allele1_ratio_max ?? 0.4,
            allele2_ratio_min: current?.allele2_ratio_min ?? 0.6,
            // Moving only the NTC corner must not accidentally freeze the
            // current AUTO-generated genotype rays into a strict manual
            // boundary override. Preserve manual cuts only if they already
            // existed; a radial-line drag remains the action that enables them.
            boundaries: ntcOnly ? current?.boundaries ?? null : editRef.current,
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
      const data = clientToData(e.clientX, e.clientY);
      const fl = gd._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (data && xa?._length && ya?._length && xa.range && ya.range) {
        const dxPx = Math.abs(data.x - ntcRef.current.corner.x) /
          Math.abs(xa.range[1] - xa.range[0]) * xa._length;
        const dyPx = Math.abs(data.y - ntcRef.current.corner.y) /
          Math.abs(ya.range[1] - ya.range[0]) * ya._length;
        if (Math.hypot(dxPx, dyPx) <= 18) {
          dragNtcRef.current = true;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
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
      if (dragNtcRef.current) {
        const data = clientToData(e.clientX, e.clientY);
        if (!data) return;
        const next = {
          key: ntcKey,
          corner: { x: Math.max(0, data.x), y: Math.max(0, data.y) },
          enabled: true,
        };
        ntcRef.current = next;
        const shapeBase = editRef.current.length;
        void Plotly.relayout(gd, {
          [`shapes[${shapeBase}].x1`]: next.corner.x,
          [`shapes[${shapeBase}].y1`]: next.corner.y,
          [`shapes[${shapeBase + 1}].x0`]: next.corner.x,
          [`shapes[${shapeBase + 1}].x1`]: next.corner.x,
          [`shapes[${shapeBase + 2}].y0`]: next.corner.y,
          [`shapes[${shapeBase + 2}].y1`]: next.corner.y,
        });
        void Plotly.restyle(
          gd,
          { x: [[next.corner.x]], y: [[next.corner.y]], "marker.symbol": "diamond" },
          [gd.data?.length ? gd.data.length - 1 : 0]
        );
        return;
      }
      const idx = dragIndexRef.current;
      if (idx == null) return;
      const cuts = [...editRef.current];
      const r = clientToRatio(e.clientX, e.clientY);
      if (r == null) return;
      const hi = idx > 0 ? cuts[idx - 1] - 0.002 : 0.999;
      const lo = idx < cuts.length - 1 ? cuts[idx + 1] + 0.002 : 0.001;
      cuts[idx] = Math.max(lo, Math.min(hi, r));
      editRef.current = cuts;
      setBoundaryEdit({ key: boundaryKey, cuts });
    };

    const onUp = () => {
      if (!dragNtcRef.current && dragIndexRef.current == null) return;
      const ntcOnly = dragNtcRef.current;
      dragNtcRef.current = false;
      dragIndexRef.current = null;
      if (ntcOnly) setNtcEdit(ntcRef.current);
      void persist(ntcOnly);
    };

    gd.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      gd.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sessionId, marker.id, marker.threshold_config, boundaryKey, ntcKey, onBoundariesPersisted]);

  useEffect(() => {
    const plot = plotRef.current;
    return () => {
      if (plot && initialized.current) {
        Plotly.purge(plot);
        initialized.current = false;
        eventsBound.current = false;
      }
    };
  }, []);

  return (
    <div
      data-testid="marker-scatter"
      data-visible-wells={scopedPoints.length}
      ref={plotRef}
      style={{ width: "100%", height: "440px" }}
    />
  );
}
