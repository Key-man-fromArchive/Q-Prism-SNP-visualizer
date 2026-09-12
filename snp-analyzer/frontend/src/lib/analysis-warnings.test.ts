import { describe, expect, it } from 'vitest';
import en from '@/locales/en';
import {
  analysisWarningSeverity,
  analysisWarningText,
  gradedAnalysisWarnings,
} from './analysis-warnings';

// P4-R1-T1 (FB-03 §8): severity grading is a mechanism for a FUTURE
// informational warning to be demoted below the fold. All three codes the
// backend emits today (relative_ntc, low_n, anchor_conflict) bear on
// genotype-call reliability and must stay "blocking" -- see
// snp-analyzer/app/models.py::WARNING_SEVERITY for the per-code rationale.
describe('analysisWarningSeverity', () => {
  it('grades all three known codes as blocking', () => {
    expect(analysisWarningSeverity('relative_ntc')).toBe('blocking');
    expect(analysisWarningSeverity('low_n')).toBe('blocking');
    expect(analysisWarningSeverity('anchor_conflict')).toBe('blocking');
  });

  it('defaults an unrecognised code to blocking (safer than silent demotion)', () => {
    expect(analysisWarningSeverity('some_future_code')).toBe('blocking');
  });
});

describe('gradedAnalysisWarnings', () => {
  it('pairs each code with its text and severity', () => {
    expect(gradedAnalysisWarnings(['relative_ntc', 'low_n'], en)).toEqual([
      { code: 'relative_ntc', text: analysisWarningText('relative_ntc', en), severity: 'blocking' },
      { code: 'low_n', text: analysisWarningText('low_n', en), severity: 'blocking' },
    ]);
  });

  it('returns an empty list for null/undefined codes (mirrors analysisWarningTexts)', () => {
    expect(gradedAnalysisWarnings(null, en)).toEqual([]);
    expect(gradedAnalysisWarnings(undefined, en)).toEqual([]);
  });
});
