// @TASK P10-PROTOCOL - shared phase-band grouping/coloring logic
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
// @TEST src/components/protocol/protocol-phase-groups.test.ts
//
// Single source for "which contiguous steps belong to the same named phase,
// and what color represents that phase" -- both the read-only summary
// (ProtocolSummary.tsx), the editable table (ProtocolTab.tsx) and the
// thermal-cycling diagram (ProtocolThermalProfile.tsx) group and color
// steps identically. Previously this grouping logic lived only inside
// ProtocolThermalProfile.tsx and `getPhaseColor` was duplicated (by
// necessity: importing a *component* file back from ProtocolTab.tsx would
// create an import cycle). A plain data module has no such cycle risk, so
// the duplication is retired here instead of tolerated a third time.
import type { ProtocolStep } from '@/types/api';
import { PROTOCOL_PHASE_COLORS, PROTOCOL_AMP_COLORS, PROTOCOL_PHASE_FALLBACK } from '@/lib/constants';

export type PhaseColor = { border: string; label: string };

export function getPhaseColor(phase: string): PhaseColor {
  if (PROTOCOL_PHASE_COLORS[phase]) return PROTOCOL_PHASE_COLORS[phase];
  const m = phase.match(/Amplification\s+(\d+)/);
  if (m) return PROTOCOL_AMP_COLORS[(parseInt(m[1]) - 1) % PROTOCOL_AMP_COLORS.length];
  return PROTOCOL_PHASE_FALLBACK;
}

export type PhaseBand = {
  phase: string;
  startIndex: number;
  endIndex: number;
  /** The band's cycle count -- meaningful only when `cyclesVary` is false.
   *  Taken from the band's first step, matching every parser's actual
   *  output (one GOTO group => one uniform `cycles` value per step), so
   *  this only diverges from "the" count after a user edits one step's
   *  `cycles` field in isolation. */
  cycles: number;
  /** True when this band's steps do not all share the same `cycles`
   *  value (only reachable through manual editing, see above) -- callers
   *  must not print a single "x N" count in that case. */
  cyclesVary: boolean;
};

/** Groups CONTIGUOUS steps that share the same non-empty `phase` string
 *  into bands. A step with an empty phase never joins (or starts) a band. */
export function groupPhaseBands(steps: ProtocolStep[]): PhaseBand[] {
  const bands: PhaseBand[] = [];
  steps.forEach((step, i) => {
    const phase = step.phase || '';
    if (!phase) return;
    const last = bands[bands.length - 1];
    if (last && last.phase === phase && last.endIndex === i - 1) {
      last.endIndex = i;
      if (step.cycles !== last.cycles) last.cyclesVary = true;
    } else {
      bands.push({ phase, startIndex: i, endIndex: i, cycles: step.cycles, cyclesVary: false });
    }
  });
  return bands;
}
