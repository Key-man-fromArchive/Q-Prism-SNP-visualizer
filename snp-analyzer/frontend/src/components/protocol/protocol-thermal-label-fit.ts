// @TASK P9-THERMAL-LABELS - narrow phase-band label fitting
// @SPEC docs/planning/feedback-2026-09-11/evidence/P9-THERMAL-LABELS.md
// @TEST src/components/protocol/ProtocolThermalProfile.test.tsx
//
// Split out of ProtocolThermalProfile.tsx (not inlined there) so that file
// can keep exporting only the component -- react-refresh/only-export-
// components otherwise flags a component file that also exports plain
// functions/constants. Same pattern as this directory's
// use-protocol-editor.ts alongside ProtocolTab.tsx.
//
// FB-05 diagram bug: a band's label was drawn dead-center with no width
// limit, so a one-step-wide band (e.g. "Pre-read") with a long phase name
// spilled into its neighbors -- multiple labels ended up interleaved and
// unreadable (evidence/P9-THERMAL-LABELS.md has the production screenshot).
// Fix: never draw a label wider than the band that owns it. Each band's
// label is centered *inside* its own [x0, x1] span, so as long as its
// rendered width doesn't exceed the band's width, it geometrically cannot
// reach a neighboring band's label -- bands are laid out edge-to-edge with
// no gap, so "fits its own band" and "doesn't collide with the neighbor"
// are the same guarantee.
//
// SVG text can't be measured before it's painted: `getComputedTextLength()`
// requires a real layout engine and returns 0 in jsdom (our test
// environment), so we can't ask the browser "how wide is this string" up
// front. Instead we estimate width from character count. 0.55em is the
// commonly cited average glyph advance width for bold Latin sans-serif
// text (e.g. Helvetica/Arial Bold AFM metrics average ~550/1000 em across
// printable ASCII) and matches this diagram's label style (fontSize 10,
// fontWeight 600). This estimate was then checked against real Chromium
// screenshots at 1440px and 768px (see evidence/P9-THERMAL-LABELS.md); it
// slightly *underestimates* the space needed for the widest characters
// (e.g. capital "W"/"M"), so in the rare case it's wrong, it errs toward
// truncating a little early rather than letting an overflow slip through.
export const CHAR_WIDTH_PX = 10 * 0.55; // 5.5px per glyph at fontSize 10

export function estimateTextWidth(text: string): number {
  return text.length * CHAR_WIDTH_PX;
}

// 8px clearance on each side, inside the band's own rect (P10 follow-up:
// the original 2px/side left adjacent full-width labels only ~4px apart --
// no overflow, but visually touching/run-on (see
// evidence/P9-THERMAL-LABELS-after-harsh-wide-light.png, e.g. "Ampl. 1
// (TD…Ampl. 2 ×1…"). Exported so tests can assert against the real budget
// instead of a magic number.
export const LABEL_HORIZONTAL_PADDING_PX = 16;

// Recognizable, order-sensitive abbreviations for the handful of long
// words this protocol vocabulary actually uses (see
// app/parsers/eds_raw.py for the phase names this must cover). Applied
// before falling back to ellipsis truncation, so a shortened label still
// reads as words ("Ampl. 1 (TD)") rather than a mid-word cut.
const PHASE_ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Initial Denaturation/, 'Init. Denat.'],
  [/Amplification/, 'Ampl.'],
  [/\(Touchdown\)/, '(TD)'],
];

function abbreviatePhase(phase: string): string {
  return PHASE_ABBREVIATIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), phase);
}

function truncateWithEllipsis(text: string, maxWidthPx: number): string | null {
  if (estimateTextWidth(text) <= maxWidthPx) return text;
  for (let len = text.length - 1; len >= 1; len--) {
    const candidate = `${text.slice(0, len).trimEnd()}…`;
    if (estimateTextWidth(candidate) <= maxWidthPx) return candidate;
  }
  return null; // not even one character + ellipsis fits: hide the label
}

/** Picks the widest label that still fits `availableWidthPx` (the band's
 *  own pixel width), trying, in order: the full text, a word-abbreviated
 *  version, then an ellipsis-truncated version. Returns null when the
 *  band is too narrow for any text at all -- callers must not draw a
 *  label in that case, but the full phase name/cycle count remains
 *  available elsewhere (per-band <title> tooltip and the screen-reader
 *  legend list; see ProtocolThermalProfile). */
export function fitPhaseLabel(phase: string, cyclesSuffix: string, availableWidthPx: number): string | null {
  const maxWidthPx = availableWidthPx - LABEL_HORIZONTAL_PADDING_PX;
  if (maxWidthPx <= 0) return null;
  const full = `${phase}${cyclesSuffix}`;
  if (estimateTextWidth(full) <= maxWidthPx) return full;
  const abbreviated = `${abbreviatePhase(phase)}${cyclesSuffix}`;
  if (estimateTextWidth(abbreviated) <= maxWidthPx) return abbreviated;
  return truncateWithEllipsis(abbreviated, maxWidthPx);
}
