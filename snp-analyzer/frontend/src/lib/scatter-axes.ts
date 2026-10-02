// Axis geometry shared by the two allele-discrimination scatter plots
// (ScatterPlot = whole plate, MarkerScatterPlot = one marker), so both range
// and shape their axes the same way.
//
// Both plots used to pass `autorange: true` and nothing else. On raw
// allele-specific endpoint RFU that is actively misleading. A real plate
// (1-2_admin_2026-09-03 16-14-11_783BR20183.pcrd, cycle 5) spans:
//
//     x (FAM)   3804 .. 11671     span 7867
//     y (HEX)   2331 ..  3369     span 1038
//
// so a tight autorange puts (0, 0) far off-canvas — the visible lower-left
// corner is (3804, 2331) and the middle of the data cloud reads as the origin —
// and it stretches x against y by ~8:1, which flattens every radial
// fam-fraction ray until the genotype wedges no longer look like the cuts they
// are. Anchoring at zero and holding the aspect fixes both.

import type { AxisMode, ScatterOrientation } from '@/stores/settings-store';

export type AxisBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

type Extent = { fam: number; allele2: number };

/** Per-axis space to show below/left of the ratio origin in NTC mode. */
export type AxisOffsets = { x: number; y: number };

const PAD = 1.05;

// Everything above and below works in allele space (`fam` / `allele2`). The
// orientation only decides, at the edge, which of the two lands on the plot's
// x axis, so each plot computes in allele space and converts once with these.

/** Allele-space pair -> plot x/y. */
export function toPlot(p: Extent, orientation: ScatterOrientation): { x: number; y: number } {
  return orientation === 'allele2_x' ? { x: p.allele2, y: p.fam } : { x: p.fam, y: p.allele2 };
}

/** Plot x/y -> allele-space pair (the inverse of `toPlot`). */
export function fromPlot(p: { x: number; y: number }, orientation: ScatterOrientation): Extent {
  return orientation === 'allele2_x' ? { fam: p.y, allele2: p.x } : { fam: p.x, allele2: p.y };
}

/** Bounds between allele space and plot axes; swapping twice is the identity. */
export function orientBounds(b: AxisBounds, orientation: ScatterOrientation): AxisBounds {
  if (orientation !== 'allele2_x') return b;
  return { xMin: b.yMin, xMax: b.yMax, yMin: b.xMin, yMax: b.xMax };
}

/** A Plotly shape drawn in allele space, mirrored onto the plot axes. */
export function orientShape(shape: Record<string, unknown>, orientation: ScatterOrientation): Record<string, unknown> {
  if (orientation !== 'allele2_x') return shape;
  return { ...shape, x0: shape.y0, y0: shape.x0, x1: shape.y1, y1: shape.x1 };
}

/** Plotly relayout patch that moves the three NTC edit shapes (rect, fam edge,
 *  allele2 edge, starting at index `base`) to `corner` while it is dragged. */
export function ntcDragRelayout(base: number, corner: Extent, orientation: ScatterOrientation): Record<string, number> {
  const rect = toPlot(corner, orientation);
  const famEdge = orientation === 'allele2_x' ? ['y0', 'y1'] : ['x0', 'x1'];
  const allele2Edge = orientation === 'allele2_x' ? ['x0', 'x1'] : ['y0', 'y1'];
  return {
    [`shapes[${base}].x1`]: rect.x,
    [`shapes[${base}].y1`]: rect.y,
    [`shapes[${base + 1}].${famEdge[0]}`]: corner.fam,
    [`shapes[${base + 1}].${famEdge[1]}`]: corner.fam,
    [`shapes[${base + 2}].${allele2Edge[0]}`]: corner.allele2,
    [`shapes[${base + 2}].${allele2Edge[1]}`]: corner.allele2,
  };
}

/** Where the data actually lies, including the NTC corner marker so it can
 *  never sit outside the plot the operator has to grab it in. */
export function dataBounds(points: Extent[], ntcCorner?: Extent | null): AxisBounds {
  const finitePoints = points.filter((p) => Number.isFinite(p.fam) && Number.isFinite(p.allele2));
  const xs = finitePoints.map((p) => p.fam);
  const ys = finitePoints.map((p) => p.allele2);
  if (ntcCorner && Number.isFinite(ntcCorner.fam) && Number.isFinite(ntcCorner.allele2)) {
    xs.push(ntcCorner.fam);
    ys.push(ntcCorner.allele2);
  }
  if (xs.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  // A degenerate axis (every well at one value) still needs a width, or Plotly
  // ranges it to a single point and nothing is visible.
  const xPad = Math.max((xHi - xLo) * (PAD - 1), Math.abs(xHi) * 0.02, 1e-6);
  const yPad = Math.max((yHi - yLo) * (PAD - 1), Math.abs(yHi) * 0.02, 1e-6);
  return {
    xMin: xLo - xPad,
    xMax: xHi + xPad,
    yMin: yLo - yPad,
    yMax: yHi + yPad,
  };
}

/** Data-fit bounds: 5% margin around the points, with the lower edge snapped
 *  to 0 only when the minimum is within 10% of the maximum of 0 (so a plot
 *  of values near zero keeps its origin), and below 0 only when a point
 *  actually is. The NTC corner is included only when the caller asks (edit
 *  mode), so a hidden corner never stretches the axes. */
export function fitBounds(points: Extent[], ntcCorner?: Extent | null): AxisBounds {
  const finitePoints = points.filter((p) => Number.isFinite(p.fam) && Number.isFinite(p.allele2));
  const xs = finitePoints.map((p) => p.fam);
  const ys = finitePoints.map((p) => p.allele2);
  if (ntcCorner && Number.isFinite(ntcCorner.fam) && Number.isFinite(ntcCorner.allele2)) {
    xs.push(ntcCorner.fam);
    ys.push(ntcCorner.allele2);
  }
  if (xs.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const [xMin, xMax] = fitAxis(Math.min(...xs), Math.max(...xs));
  const [yMin, yMax] = fitAxis(Math.min(...ys), Math.max(...ys));
  return { xMin, xMax, yMin, yMax };
}

function fitAxis(lo: number, hi: number): [number, number] {
  const pad = Math.max((hi - lo) * 0.05, Math.abs(hi) * 0.02, 1e-6);
  let min = lo - pad;
  if (lo >= 0) min = lo <= hi * 0.1 ? 0 : Math.max(0, min);
  return [min, hi + pad];
}

/** The mode in force. An operator's dropdown choice always wins; otherwise a
 *  run with NTC wells keeps the NTC basis and one without fits the data. */
export function effectiveAxisMode(mode: AxisMode, chosen: boolean, hasNtc: boolean): AxisMode {
  if (chosen) return mode;
  return hasNtc ? mode : 'auto';
}

type NtcCandidate = { well: string; manual_type?: string | null; auto_cluster?: string | null };

/** Whether the run has NTC wells: the current call (manual over auto) of a
 *  point, or a well-type assignment (manual or instrument-designated). */
export function hasNtcWells(points: NtcCandidate[], wellTypes: Record<string, string>): boolean {
  return points.some((p) => (p.manual_type ?? p.auto_cluster) === 'NTC' || wellTypes[p.well] === 'NTC');
}

/** The bounds a plot in `mode` is actually showing.
 *
 *  Used for two things: the explicit `range` handed to Plotly in the modes
 *  that have one, and the lower-left corner the NTC quadrant is drawn from.
 *  That quadrant used to be anchored at (0, 0) unconditionally, so under a
 *  tight autorange most of it was off-screen. */
export function visibleBounds(
  mode: AxisMode,
  data: AxisBounds,
  manual: AxisBounds,
  ratioOrigin?: Extent | null,
  offsets: AxisOffsets = { x: 0, y: 0 },
  fit?: AxisBounds
): AxisBounds {
  if (mode === 'manual') return manual;
  if (mode === 'auto') return fit ?? data;
  // `zero` is retained as the persisted mode name for compatibility. Its UI
  // meaning is now NTC-origin mode: leave the configured amount of space
  // below/left of the ratio origin. Negative optical values still win over
  // this floor so they remain visible.
  const safeOffset = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
  const originX = ratioOrigin && Number.isFinite(ratioOrigin.fam)
    ? ratioOrigin.fam - safeOffset(offsets.x)
    : 0;
  const originY = ratioOrigin && Number.isFinite(ratioOrigin.allele2)
    ? ratioOrigin.allele2 - safeOffset(offsets.y)
    : 0;
  return {
    xMin: Math.min(originX, data.xMin),
    xMax: Math.max(0, data.xMax, originX),
    yMin: Math.min(originY, data.yMin),
    yMax: Math.max(0, data.yMax, originY),
  };
}

/** Plotly x/y axis partials for `mode`.
 *
 *  `lockAspect` is ignored in `manual` mode: explicit bounds ARE a statement
 *  about the aspect, and Plotly would silently override one of the two ranges
 *  to satisfy `scaleanchor`, leaving inputs that no longer describe the plot. */
export function axisRangeLayout(
  mode: AxisMode,
  lockAspect: boolean,
  bounds: AxisBounds
): { xaxis: Record<string, unknown>; yaxis: Record<string, unknown> } {
  const aspect = lockAspect && mode !== 'manual'
    ? { scaleanchor: 'x', scaleratio: 1, constrain: 'domain' }
    : { scaleanchor: undefined, scaleratio: undefined };

  if (mode === 'manual') {
    return {
      xaxis: { autorange: false, range: [bounds.xMin, bounds.xMax], rangemode: 'normal' },
      yaxis: { autorange: false, range: [bounds.yMin, bounds.yMax], rangemode: 'normal', ...aspect },
    };
  }
  // `auto` (data fit) and the NTC basis both pin the range their bounds give.
  return {
    xaxis: { autorange: false, range: [bounds.xMin, bounds.xMax], rangemode: 'normal' },
    yaxis: { autorange: false, range: [bounds.yMin, bounds.yMax], rangemode: 'normal', ...aspect },
  };
}

/** Axis title `FAM (WT)`: the channel dye with the allele name in brackets.
 *  A role label such as `MT1 (VIC)` contributes only its dye; the label itself
 *  is kept when the marker has no allele name. `suffix` carries the
 *  normalization, e.g. ` / ROX`. */
export function axisTitle(label: string, alleleName: string | null | undefined, suffix = ''): string {
  const dye = label.match(/\(([^)]*)\)\s*$/)?.[1]?.trim() || label;
  return `${alleleName ? `${dye} (${alleleName})` : label}${suffix}`;
}

export const NTC_AMBER = '#f59e0b';
/** Resting colour of the genotype boundary lines: a little darker than the
 *  theme grid (#e5e7eb / #2d3040) in both themes. */
const BOUNDARY_REST_COLOR = '#9ca3af';
/** The NTC corner marker: small by default, the large drag handle in edit mode. */
export const NTC_MARKER_SIZE = 8;
export const NTC_HANDLE_SIZE = 13;

/** Boundary-line `line` style: thin and quiet at rest, bold only while the
 *  thresholds are being edited. */
export function boundaryLineStyle(editing: boolean, boldColor: string) {
  return editing
    ? { color: boldColor, width: 2, dash: 'dot' as const }
    : { color: BOUNDARY_REST_COLOR, width: 1, dash: 'dot' as const };
}

/** The NTC threshold rectangle and its two dashed edges. Drawn only while the
 *  thresholds are edited; the edges stop at the data range (`reach`) instead of
 *  running to the figure edge. At rest the small corner diamond is all that
 *  remains. */
export function ntcThresholdShapes(
  editing: boolean,
  corner: Extent,
  bounds: AxisBounds,
  reach: { x: number; y: number }
): Record<string, unknown>[] {
  if (!editing) return [];
  const edge = { color: NTC_AMBER, width: 1, dash: 'dash' };
  return [
    {
      type: 'rect',
      x0: bounds.xMin,
      y0: bounds.yMin,
      x1: corner.fam,
      y1: corner.allele2,
      fillcolor: 'rgba(245, 158, 11, 0.13)',
      line: { width: 0 },
      layer: 'below',
    },
    {
      type: 'line',
      x0: corner.fam,
      y0: bounds.yMin,
      x1: corner.fam,
      y1: Math.min(bounds.yMax, Math.max(reach.y, corner.allele2)),
      line: edge,
    },
    {
      type: 'line',
      x0: bounds.xMin,
      y0: corner.allele2,
      x1: Math.min(bounds.xMax, Math.max(reach.x, corner.fam)),
      y1: corner.allele2,
      line: edge,
    },
  ];
}

/** Legend-only trace for the boundary lines (a dotted grey stroke). */
export function boundaryLegendTrace(name: string, editing: boolean, boldColor: string): Record<string, unknown> {
  return {
    x: [null],
    y: [null],
    mode: 'lines',
    type: 'scatter',
    uid: 'legend-boundary',
    name,
    hoverinfo: 'skip',
    line: boundaryLineStyle(editing, boldColor),
    selected: { marker: { opacity: 1 } },
    unselected: { marker: { opacity: 1 } },
  };
}

/** Round a bound to something an operator can read in a number input without
 *  it looking like noise (3 significant-ish figures, magnitude-aware). */
export function roundBound(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 0;
  if (magnitude >= 100) return Math.round(value);
  if (magnitude >= 1) return Math.round(value * 100) / 100;
  return Math.round(value * 10000) / 10000;
}
