// Diagnostic codes the clustering endpoints attach to a run, turned into
// something an operator can act on.
//
// These used to be rendered by joining the raw codes ("relative_ntc"), which
// told nobody anything — least of all the one that matters most: that the
// low-signal wells on the plate were deliberately NOT called NTC and why.
import type { Translations } from '@/locales/en';
import type { WarningSeverity } from '@/types/api';

// P4-R1-T1 (FB-03 §8): severity grading, mirroring
// snp-analyzer/app/models.py::WARNING_SEVERITY. FB-03 wants low-signal
// warnings demotable to the bottom of the results screen, but that is only
// safe for warnings that are purely informational -- anything that bears on
// genotype-call reliability ("blocking") must stay where it will be seen.
//
// Per-code rationale (see app/processing/clustering.py for the call sites):
//   "relative_ntc"    -- flips affected wells' label from NTC to
//                         Undetermined; changes the reported call outcome.
//   "low_n"           -- calls made with no mixture model fit, capped at
//                         a low confidence specifically because there is no
//                         statistical evidence behind them.
//   "anchor_conflict" -- the operator's dosage-origin anchors were mutually
//                         inconsistent and discarded; the origin genotype
//                         calls are measured against sits on that anchor
//                         scale.
//
// All three codes the backend emits today are "blocking". This map is the
// MECHANISM for a future informational ("advisory") warning to be demoted --
// it does not demote anything that exists today. Demoting one of these three
// is a QC policy decision for the product owner, not something to infer here.
const WARNING_SEVERITY: Record<string, WarningSeverity> = {
  relative_ntc: 'blocking',
  low_n: 'blocking',
  anchor_conflict: 'blocking',
};

// An unrecognised code defaults to "blocking": showing an unfamiliar
// diagnostic prominently is safer than silently demoting one nobody has
// vetted yet.
const DEFAULT_WARNING_SEVERITY: WarningSeverity = 'blocking';

export function analysisWarningSeverity(code: string): WarningSeverity {
  return WARNING_SEVERITY[code] ?? DEFAULT_WARNING_SEVERITY;
}

export type GradedAnalysisWarning = {
  code: string;
  text: string;
  severity: WarningSeverity;
};

// Convenience combinator for a future consumer that needs to split warnings
// by severity (e.g. to keep "blocking" ones above the fold and demote
// "advisory" ones) without re-deriving text/severity separately.
export function gradedAnalysisWarnings(
  codes: string[] | null | undefined,
  t: Translations
): GradedAnalysisWarning[] {
  return (codes ?? []).map((code) => ({
    code,
    text: analysisWarningText(code, t),
    severity: analysisWarningSeverity(code),
  }));
}

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
