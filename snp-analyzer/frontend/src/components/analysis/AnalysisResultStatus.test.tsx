import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { AnalysisResultStatus } from './AnalysisResultStatus';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useLanguageStore } from '@/stores/language-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { AnalysisContext } from '@/types/api';

const thresholds = { ntc_threshold: 0.1, ntc_fam_max: null, ntc_allele2_max: null,
  allele1_ratio_max: 0.4, allele2_ratio_min: 0.6, boundaries: null, offset: 0, dosage_max: null };
function verified() {
  const context: AnalysisContext = { schema_version: 1, result_revision: '11111111-1111-4111-8111-111111111111',
    analysed_at: '2026-09-07T00:00:00Z', cycle: 20, use_rox: false, normalization_applied: false,
    background: 'none', algorithm: 'auto', input_revision: 0, regions: [], parameters: {
      requested_algorithm: 'auto', ploidy: 2, n_clusters: 4, n_clusters_applied: false, threshold_config: thresholds,
      actual_window: { boundaries: [0.7, 0.3], offset: 0, dosage_max: null, offset_uncertain: false, low_separation: false },
      scope: 'whole_plate', effective_well_types: {}, manual_well_types: {}, excluded_wells: [],
      ratio_origin: { fam: 0, allele2: 0, source: 'zero' } } };
  useNavigationStore.setState({ availableCycles: [20, 40] });
  useSettingsStore.setState({ ploidy: 2, clusterAlgorithm: 'threshold' });
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {}, analysis_context: context },
    currentInputRevision: 0, status: 'completed', currentRequest: { algorithm: 'auto', cycle: 20, n_clusters: 4,
      use_rox: false, background: 'none', threshold_config: thresholds } });
}

beforeEach(() => {
  useLanguageStore.setState({ language: 'en' });
  useAnalysisStore.getState().setSession('s', 'u');
});
it('labels retained legacy results separately from the latest failed request', () => {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {} }, status: 'failed', error: new Error('offline') });
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Legacy result/)).toBeInTheDocument();
  expect(screen.getByText(/Latest analysis failed/)).toBeInTheDocument();
  expect(screen.getByText(/20/)).toBeInTheDocument();
});
it('shows pending and input refresh failure independently without discarding the result', () => {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {} }, pending: true,
    status: 'computing', inputRevisionError: new Error('metadata') });
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Analysis in progress/)).toBeInTheDocument();
  expect(screen.getByText(/Input revision could not be verified/)).toBeInTheDocument();
});
it('labels an absent result explicitly', () => {
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/No completed analysis/)).toBeInTheDocument();
});
it('compares explicit AUTO input rather than global threshold or fitted result boundaries', () => {
  verified();
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Current conditions match/)).toBeInTheDocument();
});
it('withdraws condition comparison while marker metadata is unavailable but retains completed provenance', () => {
  verified();
  const view = render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Current conditions match/)).toBeInTheDocument();
  view.rerender(<AnalysisResultStatus markers={null} />);
  expect(screen.queryByText(/Current conditions match|Current view differs/)).not.toBeInTheDocument();
  expect(screen.getByText(/20/)).toBeInTheDocument();
  expect(screen.getByText(/Current analysis conditions cannot be compared/)).toBeInTheDocument();
});
it.each([
  { cycle: 40 }, { use_rox: true }, { background: 'channel_min' as const }, { algorithm: 'kmeans' as const },
  { ploidy: 4 }, { threshold_config: { ...thresholds, boundaries: [0.6, 0.4] } },
])('shows changed current conditions %j', patch => {
  verified();
  useAnalysisStore.setState(state => ({ currentRequest: { ...state.currentRequest!, ...patch } }));
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Current view differs/)).toBeInTheDocument();
});
it('separates stale input from condition equality', () => {
  verified();
  useAnalysisStore.setState({ currentInputRevision: 1 });
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Inputs changed/)).toBeInTheDocument();
  expect(screen.getByText(/Current conditions match/)).toBeInTheDocument();
});
it('labels incomplete provenance and unknown input honestly', () => {
  verified();
  const result = structuredClone(useAnalysisStore.getState().result!);
  delete result.analysis_context!.parameters.manual_well_types;
  useAnalysisStore.setState({ result });
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText(/Incomplete analysis provenance/)).toBeInTheDocument();
  expect(screen.queryByText(/Current conditions match/)).not.toBeInTheDocument();
});
it.each([0, 40])('compares selected absolute zero with captured cycle %s', (capturedCycle) => {
  verified();
  useNavigationStore.setState({ availableCycles: [0, 10, 40] });
  useAnalysisStore.setState(state => ({ currentRequest: { ...state.currentRequest!, cycle: 0 },
    result: { ...state.result!, cycle: capturedCycle,
      analysis_context: { ...state.result!.analysis_context!, cycle: capturedCycle } } }));
  render(<AnalysisResultStatus markers={[]} />);
  if (capturedCycle === 0) expect(screen.getByText(/Current conditions match/)).toBeInTheDocument();
  else expect(screen.getByText(/Current view differs/)).toBeInTheDocument();
});
it('presents Korean mismatch reasons and captured cycle without backend field identifiers', () => {
  verified();
  useLanguageStore.setState({ language: 'ko' });
  useAnalysisStore.setState(state => ({ currentRequest: { ...state.currentRequest!, cycle: 40 } }));
  render(<AnalysisResultStatus markers={[]} />);
  expect(screen.getByText('마지막 완료 사이클: 20')).toBeInTheDocument();
  expect(screen.getByText(/현재 보기와 완료 분석의 조건이 다릅니다: 사이클/)).toBeInTheDocument();
});
