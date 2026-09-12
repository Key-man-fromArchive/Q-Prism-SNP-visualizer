// @TASK P10-PROTOCOL - shared phase-group header row (read-only summary +
// editable table)
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
// @TEST src/components/protocol/ProtocolTab.test.tsx
//
// Renders once per contiguous MULTI-step phase band (a single-step band
// whose name is redundant with its own step's label is inlined onto that
// step's row instead -- see `isRedundantSingletonBand` and
// ProtocolStepsTable.tsx), colored to match the band this same phase draws
// in ProtocolThermalProfile.tsx (both read from protocol-phase-groups.ts,
// never a second copy of the color map) so a user can visually trace
// "this row group" to "this stripe in the diagram" -- the "tier별 시각적
// 구분" the user asked for. Color is never the ONLY differentiator: the
// phase name, its own left border and (when applicable) the repeat-range
// text carry the same information without relying on hue perception.
import { getPhaseColor, type PhaseBand } from './protocol-phase-groups';
import { resolveGotoRange, type GotoRangeInfo } from './protocol-goto-range';
import type { ProtocolStep } from '@/types/api';
import type { Translations } from '@/locales/en';

/** goto_label lives on the band's trailing step (see both parsers) --
 *  resolveGotoRange cross-checks its embedded numbers against this band's
 *  CURRENT first/last step number and the trailing step's CURRENT cycle
 *  count, so a stale label (steps deleted/renumbered since load, or this
 *  step's own cycle count hand-edited) is caught structurally rather than
 *  through a separate "was anything edited" flag. Shared by the header
 *  row and by a redundant singleton band's inline badges (below) so both
 *  resolve the exact same verdict from the exact same inputs. */
function resolveBandBadges(band: PhaseBand, steps: ProtocolStep[]): { goto: GotoRangeInfo; cyclesBadge: string | null } {
  const firstStep = steps[band.startIndex];
  const lastStep = steps[band.endIndex];
  const goto = resolveGotoRange(lastStep.goto_label, firstStep.step, lastStep.step, lastStep.cycles);
  const cyclesBadge = goto.kind === 'none' && !band.cyclesVary && band.cycles > 1 ? `×${band.cycles}` : null;
  return { goto, cyclesBadge };
}

/** The small phase-colored dot alone, no wrapper -- a visual anchor placed
 *  right before whatever text names the phase (the header's own phase
 *  name, or a redundant singleton band's step label standing in for it),
 *  independent of the differentiator(s) that follow it (color is never
 *  the ONLY cue: this dot + the row's own left border +, when a band
 *  isn't a redundant singleton, the phase name text all say the same
 *  thing without relying on hue perception alone). */
export function PhaseDot({ phase }: { phase: string }) {
  const color = getPhaseColor(phase);
  return (
    <span
      aria-hidden="true"
      style={{ width: '8px', height: '8px', borderRadius: '9999px', background: color.border, display: 'inline-block', flexShrink: 0 }}
    />
  );
}

/** The phase name (optional) + GOTO-range/stale/cycles badges -- no dot,
 *  no <tr>/<td> wrapper. Reused by `ProtocolPhaseGroupHeader` (its own
 *  header row, `showPhaseName`) and inlined onto a redundant singleton
 *  band's own step row, after that row's label (`!showPhaseName`, since
 *  the label already says the same word the phase name would -- only the
 *  badges, if any, are new information worth adding). */
export function PhaseBandBadges({
  band,
  steps,
  t,
  showPhaseName,
}: {
  band: PhaseBand;
  steps: ProtocolStep[];
  t: Translations;
  showPhaseName: boolean;
}) {
  const color = getPhaseColor(band.phase);
  const { goto, cyclesBadge } = resolveBandBadges(band, steps);

  let rangeNode: React.ReactNode = null;
  if (goto.kind === 'range') {
    rangeNode = (
      <span data-testid={`protocol-goto-range-${band.phase}-${band.startIndex}`} className="text-info">
        {t.protocolGotoRange(goto.firstStep, goto.lastStep, goto.totalCycles)}
      </span>
    );
  } else if (goto.kind === 'stale') {
    // Never assert the original (now-unverifiable) range with specific
    // numbers -- this project's standing rule for an unknown fact (see
    // OverlayProcessingStatus's "unreported", ScatterResponse's
    // `referenceBasisUnknown`).
    rangeNode = (
      <span data-testid="protocol-goto-stale" className="text-text-muted italic">
        {t.protocolGotoStale}
      </span>
    );
  } else if (goto.kind === 'raw') {
    // Backend-generated text that didn't match either known shape: shown
    // verbatim rather than silently dropped. Always English (it comes
    // straight from the parser, not a translation table) -- same as this
    // project's pre-existing behavior for this string.
    rangeNode = <span className="text-info">{goto.text}</span>;
  }

  const hasBadge = Boolean((band.cyclesVary && !rangeNode) || cyclesBadge || rangeNode);
  if (!showPhaseName && !hasBadge) return null;

  return (
    <span className="inline-flex items-center gap-2 flex-wrap" style={{ fontSize: '11px' }}>
      {showPhaseName && <span style={{ color: color.label, fontWeight: 700 }}>{band.phase}</span>}
      {band.cyclesVary && !rangeNode && <span className="text-text-muted">{t.protocolCyclesVary}</span>}
      {cyclesBadge && <span className="text-text-muted">{cyclesBadge}</span>}
      {rangeNode}
    </span>
  );
}

export function ProtocolPhaseGroupHeader({
  band,
  steps,
  colSpan,
  t,
}: {
  band: PhaseBand;
  steps: ProtocolStep[];
  colSpan: number;
  t: Translations;
}) {
  const color = getPhaseColor(band.phase);
  return (
    <tr
      data-testid={`protocol-group-header-${band.phase}-${band.startIndex}`}
      className="bg-bg"
      style={{ borderLeft: `3px solid ${color.border}`, borderBottom: '1px solid var(--color-border)' }}
    >
      <td colSpan={colSpan} style={{ padding: '6px 10px' }}>
        <span className="inline-flex items-center gap-2">
          <PhaseDot phase={band.phase} />
          <PhaseBandBadges band={band} steps={steps} t={t} showPhaseName />
        </span>
      </td>
    </tr>
  );
}
