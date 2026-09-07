export type PlotlyAxis = { _length?: number; _offset?: number; range?: [number, number] };

function axisPosition(axis: PlotlyAxis | undefined, pixel: number, inverted: boolean): number | null {
  if (!axis?._length || !axis.range) return null;
  const local = pixel - (axis._offset ?? 0);
  if (local < 0 || local > axis._length) return null;
  const fraction = local / axis._length;
  const [low, high] = axis.range;
  return inverted ? high - fraction * (high - low) : low + fraction * (high - low);
}

/** Convert only positions within initialized axes; Plotly internals are optional. */
export function clientPoint(
  xaxis: PlotlyAxis | undefined,
  yaxis: PlotlyAxis | undefined,
  box: { left: number; top: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const x = axisPosition(xaxis, clientX - box.left, false);
  const y = axisPosition(yaxis, clientY - box.top, true);
  return x === null || y === null ? null : { x, y };
}

export function textCustomdata(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
