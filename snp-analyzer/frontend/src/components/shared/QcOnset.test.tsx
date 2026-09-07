import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { QcOnset } from './QcOnset';
import { useLanguageStore } from '@/stores/language-store';
import { useAnalysisStore } from '@/stores/analysis-store';

beforeEach(() => { useAnalysisStore.getState().clear(); useLanguageStore.setState({ language: 'en' }); });
it.each([
  ['en', 'detected', 0, 'none', 'NTC rise detected at cycle 0'],
  ['en', 'not_detected', null, 'none', 'NTC rise not detected'],
  ['en', 'not_evaluated', null, 'no_ntc', 'NTC rise not evaluated'],
  ['ko', 'detected', 0, 'none', 'NTC 상승 검출 사이클 0'],
  ['ko', 'not_detected', null, 'none', 'NTC 상승 미검출'],
  ['ko', 'not_evaluated', null, 'no_ntc', 'NTC 상승 평가 불가'],
] as const)('distinguishes explicit onset %s %s from plate contamination', (language, status, cycle, reason, message) => {
  useLanguageStore.setState({ language });
  useAnalysisStore.setState({ recommendation: { inputRevision: 0, suggestion: {
    ntc_onset_status: status, ntc_onset_cycle: cycle, ntc_onset_reason: reason, ntc_wells: [],
    suggested_cycle: 0, suggested_low: null, suggested_high: null, suggested_window: null, amp_start: 0, amp_end: 40,
  } } });
  render(<QcOnset />);
  expect(screen.getByText(message)).toBeInTheDocument();
  if (reason === 'no_ntc') {
    expect(screen.getByText(language === 'en' ? 'No NTC curves identified' : 'NTC 곡선을 식별하지 못함')).toBeInTheDocument();
  }
  expect(screen.getByText(/Full-curve|전체 곡선/)).toBeInTheDocument();
  expect(screen.queryByText(/no NTC contamination/)).not.toBeInTheDocument();
});
it('does not infer onset when no explicit recommendation was requested', () => {
  const { container } = render(<QcOnset />);
  expect(container).toBeEmptyDOMElement();
});
