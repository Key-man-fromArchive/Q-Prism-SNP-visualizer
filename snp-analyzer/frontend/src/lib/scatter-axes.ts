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

import type { AxisMode } from '@/stores/settings-store';

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
  offsets: AxisOffsets = { x: 0, y: 0 }
): AxisBounds {
  if (mode === 'manual') return manual;
  if (mode === 'auto') return data;
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
  if (mode === 'auto') {
    return {
      xaxis: { autorange: true, range: undefined, rangemode: 'normal' },
      yaxis: { autorange: true, range: undefined, rangemode: 'normal', ...aspect },
    };
  }
  return {
    xaxis: { autorange: false, range: [bounds.xMin, bounds.xMax], rangemode: 'normal' },
    yaxis: { autorange: false, range: [bounds.yMin, bounds.yMax], rangemode: 'normal', ...aspect },
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
