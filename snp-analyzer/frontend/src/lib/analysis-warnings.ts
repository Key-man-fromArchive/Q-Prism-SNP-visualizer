// Diagnostic codes the clustering endpoints attach to a run, turned into
// something an operator can act on.
//
// These used to be rendered by joining the raw codes ("relative_ntc"), which
// told nobody anything — least of all the one that matters most: that the
// low-signal wells on the plate were deliberately NOT called NTC and why.
import type { Translations } from '@/locales/en';

export function analysisWarningText(code: string, t: Translations): string {
  switch (code) {
    case 'relative_ntc':
      return t.analysisWarningRelativeNtc;
    case 'low_n':
      return t.analysisWarningLowN;
    case 'anchor_conflict':
      return t.analysisWarningAnchorConflict;
    default:
      // An unmapped code is still worth showing verbatim — better a raw string
      // than silence about a diagnostic the backend went out of its way to
      // report.
      return code;
  }
}

export function analysisWarningTexts(
  codes: string[] | null | undefined,
  t: Translations
): string[] {
  return (codes ?? []).map((code) => analysisWarningText(code, t));
}
