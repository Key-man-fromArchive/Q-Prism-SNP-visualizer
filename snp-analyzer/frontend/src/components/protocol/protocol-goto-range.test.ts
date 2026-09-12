import { describe, expect, it } from 'vitest';
import { parseGotoLabel, resolveGotoRange } from './protocol-goto-range';

describe('parseGotoLabel', () => {
  it('parses a multi-step range', () => {
    expect(parseGotoLabel('↩ Repeat Steps 3-4 × 10 cycles')).toEqual({ firstStep: 3, lastStep: 4, totalCycles: 10 });
  });

  it('parses a single-step loop', () => {
    expect(parseGotoLabel('↩ Repeat Step 5 × 25 cycles')).toEqual({ firstStep: 5, lastStep: 5, totalCycles: 25 });
  });

  it('returns null for an empty string', () => {
    expect(parseGotoLabel('')).toBeNull();
  });

  it('returns null for text that does not match either generated shape (hand-authored or unrecognized)', () => {
    expect(parseGotoLabel('some custom note')).toBeNull();
    expect(parseGotoLabel('↩ Loop back sometimes')).toBeNull();
  });
});

describe('resolveGotoRange', () => {
  it('reports "none" when there is no goto_label', () => {
    expect(resolveGotoRange('', 3, 4, 10)).toEqual({ kind: 'none' });
  });

  it('reports the parsed range when the numbers still match the band', () => {
    expect(resolveGotoRange('↩ Repeat Steps 3-4 × 10 cycles', 3, 4, 10)).toEqual({
      kind: 'range', firstStep: 3, lastStep: 4, totalCycles: 10,
    });
  });

  it('reports the parsed range for a single-step loop when it matches', () => {
    expect(resolveGotoRange('↩ Repeat Step 5 × 25 cycles', 5, 5, 25)).toEqual({
      kind: 'range', firstStep: 5, lastStep: 5, totalCycles: 25,
    });
  });

  // The exact regression this exists for: deleting an earlier step
  // renumbers every later step (see ProtocolTab.tsx's handleDeleteStep),
  // but the stored goto_label text is never rewritten to match.
  it('reports "stale" when the step numbers no longer match after a renumber', () => {
    // Originally steps 3-4; after an earlier step was deleted, this band
    // is now steps 2-3, but its stored label still says "3-4".
    expect(resolveGotoRange('↩ Repeat Steps 3-4 × 10 cycles', 2, 3, 10)).toEqual({ kind: 'stale' });
  });

  it('reports "stale" when the cycle count on the trailing step was edited', () => {
    expect(resolveGotoRange('↩ Repeat Steps 3-4 × 10 cycles', 3, 4, 12)).toEqual({ kind: 'stale' });
  });

  it('reports "raw" (verbatim, not discarded) for a label neither generated shape recognizes', () => {
    expect(resolveGotoRange('custom hand note', 3, 4, 10)).toEqual({ kind: 'raw', text: 'custom hand note' });
  });
});
