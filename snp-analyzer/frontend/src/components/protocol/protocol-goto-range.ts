// @TASK P10-PROTOCOL - GOTO repeat-range parsing without inventing a
// structured backend field
// @SPEC docs/planning/feedback-2026-09-11/evidence/P10-PROTOCOL-UI.md
// @TEST src/components/protocol/protocol-goto-range.test.ts
//
// `ProtocolStep.goto_label` is a free-text string produced once, at parse
// time, by app/parsers/eds_raw.py / pcrd_raw.py -- e.g.
// "↩ Repeat Steps 3-4 × 10 cycles" or, for a single-step loop,
// "↩ Repeat Step 5 × 25 cycles". It is attached to the LAST step
// of the repeated range (see both parsers), which is exactly the `endIndex`
// step of that phase's `PhaseBand` (protocol-phase-groups.ts).
//
// This module does NOT add a structured `repeat_from_step` field to the
// backend model (out of scope, and PCRD's GotoStep can target an arbitrary
// earlier step, so a naive "previous N steps" assumption is unsafe -- see
// app/parsers/pcrd_raw.py's GotoStep handling). Instead it parses the
// backend's own free-text sentence back into numbers ONLY for display, and
// -- critically -- cross-checks those numbers against the step's CURRENT
// position/step-number/cycle-count. Deleting an earlier step renumbers
// every step after it (ProtocolTab.tsx's handleDeleteStep), but the stored
// goto_label string is never rewritten, so after a delete the label can
// describe a range that no longer matches reality. Rather than track a
// separate "was anything edited" flag, staleness falls out naturally from
// this cross-check: if the label's own numbers still match the step's
// current step-number/step-number/cycle-count, showing them is safe. If
// they don't, this project's standing rule applies (see chartBackground's
// "unreported" state, ScatterResponse's `unreported` reference basis): show
// that the fact is no longer known, not a specific number we can't vouch
// for.
const RANGE = /^↩ Repeat Steps (\d+)-(\d+) × (\d+) cycles$/;
const SINGLE = /^↩ Repeat Step (\d+) × (\d+) cycles$/;

export type ParsedGotoRange = { firstStep: number; lastStep: number; totalCycles: number };

/** Parses a backend-generated goto_label back into numbers. Returns null
 *  for anything that doesn't match the two known-generated shapes --
 *  including hand-edited or otherwise unrecognized text, which callers
 *  must fall back to displaying verbatim (see `resolveGotoRange`), never
 *  silently dropping it. */
export function parseGotoLabel(label: string): ParsedGotoRange | null {
  if (!label) return null;
  const range = label.match(RANGE);
  if (range) return { firstStep: Number(range[1]), lastStep: Number(range[2]), totalCycles: Number(range[3]) };
  const single = label.match(SINGLE);
  if (single) return { firstStep: Number(single[1]), lastStep: Number(single[1]), totalCycles: Number(single[2]) };
  return null;
}

export type GotoRangeInfo =
  | { kind: 'none' }
  | ({ kind: 'range' } & ParsedGotoRange)
  | { kind: 'stale' }
  | { kind: 'raw'; text: string };

/** Resolves a band's trailing step's `goto_label` into a display-ready
 *  verdict:
 *  - 'none': no goto_label at all (e.g. Pre-read/Post-read, or a cycling
 *    phase whose parser didn't emit one).
 *  - 'range': the label parsed AND its numbers still match the band's
 *    current first/last step number and the trailing step's current
 *    cycle count -- safe to show the specific range.
 *  - 'stale': the label parsed but at least one number no longer matches
 *    (steps were deleted/renumbered, or this step's cycle count was
 *    edited) -- the original range can no longer be vouched for.
 *  - 'raw': the label didn't match either known shape (hand-authored,
 *    or a format this project's parsers don't currently produce) --
 *    display it exactly as given rather than discard it. */
export function resolveGotoRange(
  gotoLabel: string,
  firstStepNumber: number,
  lastStepNumber: number,
  lastStepCycles: number,
): GotoRangeInfo {
  if (!gotoLabel) return { kind: 'none' };
  const parsed = parseGotoLabel(gotoLabel);
  if (!parsed) return { kind: 'raw', text: gotoLabel };
  const matches =
    parsed.firstStep === firstStepNumber &&
    parsed.lastStep === lastStepNumber &&
    parsed.totalCycles === lastStepCycles;
  return matches ? { kind: 'range', ...parsed } : { kind: 'stale' };
}
