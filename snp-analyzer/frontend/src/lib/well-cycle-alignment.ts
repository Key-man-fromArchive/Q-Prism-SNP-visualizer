// @TASK P19-CYCLE-ALIGN - shared well x cycle alignment for the values
// table and the CSV export
// @SPEC docs/planning/feedback-2026-09-11/evidence/P19-CYCLE-ALIGN.md
// @TEST src/lib/well-cycle-alignment.test.ts
//
// Each well's amplification curve carries its OWN cycles array. The
// backend does not guarantee every well shares the same one:
// app/parsers/generic_table.py's _to_duplex_unified() only emits a
// (well, cycle) reading when EVERY required channel has a value for it,
// so a well missing one channel's reading at a cycle silently loses that
// cycle while a sibling well keeps it; app/import_models.py's ImportRun
// validator checks readings against known channel_ids and duplicate
// keys, not cross-well cycle parity; and normalize()/amplification_all()
// in app/routers/data.py group points by well from whatever readings
// exist for it, with no gap-filling to a common grid. Lining values up
// by ARRAY INDEX (curve.values[i] under column i) silently mislabels one
// well's cycle 3 value as another well's cycle 2 value whenever their
// cycle arrays diverge in length or content. Everything here aligns by
// CYCLE NUMBER instead, so the table and the CSV cannot drift apart.

export interface WellCycleCurve {
  well: string;
  cycles: number[];
  values: number[];
}

/** All cycle numbers appearing in ANY well's curve, sorted ascending.
 *  This is the shared column header set for both the table and the CSV --
 *  a union, not just well[0]'s cycles, so no well's data is ever dropped
 *  or misaligned because it happened to render first. */
export function unionCycles(curves: Pick<WellCycleCurve, "cycles">[]): number[] {
  const set = new Set<number>();
  for (const curve of curves) {
    for (const cycle of curve.cycles) set.add(cycle);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** True when at least one well's own cycle count is narrower than the
 *  union -- i.e. some (well, cycle) cell in the aligned table/CSV will be
 *  a gap, not a real reading. Callers use this to decide whether an
 *  explicit notice is owed to the user: silently unioning cycle sets
 *  produces blanks the user has no way to explain on their own. */
export function cycleSetsDiffer(curves: Pick<WellCycleCurve, "cycles">[]): boolean {
  const union = unionCycles(curves);
  return curves.some((curve) => curve.cycles.length !== union.length);
}

/** Maps `curve`'s own cycle numbers to its values, so a lookup is by
 *  CYCLE NUMBER rather than by array index. */
export function cycleValueMap(curve: WellCycleCurve): Map<number, number> {
  const map = new Map<number, number>();
  curve.cycles.forEach((cycle, i) => map.set(cycle, curve.values[i]));
  return map;
}
