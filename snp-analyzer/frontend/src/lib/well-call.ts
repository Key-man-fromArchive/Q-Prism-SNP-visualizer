// @TASK MULTI-CURVE-T0 - one rule for "which call does this well show"
// @SPEC docs/planning/multi-well-curves-2026-10-04/PLAN.md#d5-콜-출처-공용화
// @TEST src/lib/well-call.test.ts
//
// PlateView and the amplification curves must colour a well by the same call.
// Single-marker screens read the well's manual/automatic call through the
// "show manual / show automatic" settings; the multi-marker screen reads the
// selected marker's assignments, where a well outside the marker has none.
import { displayedCall } from '@/lib/chart-semantics';

type CallPoint = Readonly<{ manual_type: string | null; auto_cluster: string | null }>;

export type WellCallContext = {
  /** Per-well manual/automatic calls (plate or scatter rows). */
  points?: ReadonlyMap<string, CallPoint>;
  showManualTypes?: boolean;
  showAutoCluster?: boolean;
  /** When given, replaces `points`: the selected marker's well -> call map. */
  assignments?: Readonly<Record<string, string>> | null;
};

export function callForWell(well: string, ctx: WellCallContext): string | null {
  if (ctx.assignments !== undefined) return ctx.assignments?.[well] ?? null;
  return displayedCall(ctx.points?.get(well), ctx.showManualTypes ?? false, ctx.showAutoCluster ?? false);
}
