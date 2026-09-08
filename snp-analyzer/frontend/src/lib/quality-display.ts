export function focusedQualityWell(well: string, revealed: string | null, selected: ReadonlySet<string>) {
  return well === revealed || selected.has(well);
}
/** Only display filtering changes. Callers still supply actual, scoped measured points. */
export function visibleQualityPoint(point: { well: string; manual_type: string | null }, revealed: string | null,
  visible: boolean, focused: boolean, selected: ReadonlySet<string>) {
  if (point.well === revealed) return true;
  return point.manual_type !== 'Omit' && visible && (!focused || focusedQualityWell(point.well, revealed, selected));
}
