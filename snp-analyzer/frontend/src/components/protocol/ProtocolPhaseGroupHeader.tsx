// @TASK P10-PROTOCOL - shared phase-group header row (read-only summary +
// editable table)
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
// @TEST src/components/protocol/ProtocolTab.test.tsx
//
// Renders once per contiguous phase band, colored to match the band this
// same phase draws in ProtocolThermalProfile.tsx (both read from
// protocol-phase-groups.ts, never a second copy of the color map) so a
// user can visually trace "this row group" to "this stripe in the
// diagram" -- the "tier별 시각적 구분" the user asked for. Color is never
// the ONLY differentiator: the phase name, its own left border and (when
// applicable) the repeat-range text carry the same information without
// relying on hue perception.
import { getPhaseColor, type PhaseBand } from './protocol-phase-groups';
import { resolveGotoRange } from './protocol-goto-range';
import type { ProtocolStep } from '@/types/api';
import type { Translations } from '@/locales/en';

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
  const firstStep = steps[band.startIndex];
  const lastStep = steps[band.endIndex];
  // goto_label lives on the band's trailing step (see both parsers) --
  // resolveGotoRange cross-checks its embedded numbers against this band's
  // CURRENT first/last step number and the trailing step's CURRENT cycle
  // count, so a stale label (steps deleted/renumbered since load, or this
  // step's own cycle count hand-edited) is caught structurally rather than
  // through a separate "was anything edited" flag.
  const goto = resolveGotoRange(lastStep.goto_label, firstStep.step, lastStep.step, lastStep.cycles);

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

  const cyclesBadge = !rangeNode && !band.cyclesVary && band.cycles > 1 ? `×${band.cycles}` : null;

  return (
    <tr
      data-testid={`protocol-group-header-${band.phase}-${band.startIndex}`}
      className="bg-bg"
      style={{ borderLeft: `3px solid ${color.border}`, borderBottom: '1px solid var(--color-border)' }}
    >
      <td colSpan={colSpan} style={{ padding: '6px 10px' }}>
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: '11px' }}>
          <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '9999px', background: color.border, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: color.label, fontWeight: 700 }}>{band.phase}</span>
          {band.cyclesVary && !rangeNode && <span className="text-text-muted">{t.protocolCyclesVary}</span>}
          {cyclesBadge && <span className="text-text-muted">{cyclesBadge}</span>}
          {rangeNode}
        </div>
      </td>
    </tr>
  );
}
