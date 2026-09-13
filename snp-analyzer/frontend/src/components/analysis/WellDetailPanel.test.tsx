import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WellDetailPanel } from './WellDetailPanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { getAmplification } from '@/lib/api';
import en from '@/locales/en';
import ko from '@/locales/ko';
import { useSettingsStore } from '@/stores/settings-store';
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
for (const language of ['en', 'ko'] as const) for (const call of ['Positive Control', 'Unknown', 'AABB']) {
  it(`localizes detail and recorded call labels without changing calls ${language}/${call}`, () => {
    const t = language === 'en' ? en : ko;
    useLanguageStore.getState().setLanguage(language);
    useSessionStore.setState({ sessionId: null, sessionInfo: null });
    useSelectionStore.setState({ selectedWell: 'A1' });
    const point = { well: 'A1', sample_name: 'Synthetic', norm_fam: 1, norm_allele2: 2, raw_fam: 1, raw_allele2: 2, raw_rox: null, auto_cluster: 'Positive Control', manual_type: call };
    useDataStore.setState({ scatterPoints: [point] });
    const { container } = render(<WellDetailPanel ploidyOverride={4} />);
    const expected = call === 'Positive Control' ? t.wellTypePositiveControl : call === 'Unknown' ? t.wellTypeUnknown : call;
    expect(container.querySelector('#detail-content > table')).toHaveTextContent(expected);
    expect(container.querySelector('details table')).toHaveTextContent(t.wellTypePositiveControl);
    expect(container.querySelector('details table')).toHaveTextContent(expected);
    expect(useDataStore.getState().scatterPoints).toEqual([point]);
  });
}
for (const language of ['en', 'ko'] as const) for (const applied of [undefined, false, true]) {
  it(`separates known scatter basis from unreported curve basis ${language}/${applied}`, async () => {
    const t = language === 'en' ? en : ko;
    useLanguageStore.getState().setLanguage(language);
    useSettingsStore.setState({ useRox: true });
    useSessionStore.setState({ sessionId: 'basis', sessionInfo: { session_id: 'basis', instrument: 'synthetic', allele2_dye: 'HEX', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
    useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
    useDataStore.getState().setScatterData([{ well: 'A1', sample_name: null, norm_fam: 1, norm_allele2: 2, raw_fam: 1, raw_allele2: 2, raw_rox: null, auto_cluster: null, manual_type: null }], 'HEX', null, null, { applied });
    vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'HEX', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 2] }] });
    const view = render(<WellDetailPanel />);
    const details = view.container.querySelector('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    expect(screen.getByTestId('scatter-reading-basis')).toHaveTextContent(t.scatterReferenceBasis(true, applied !== undefined, applied === true));
  });
}
// @TASK P12-TOGGLE - the curve CHART moved out of this panel entirely
// (AmplificationCurvePanel, in the results screen's large plot area); this
// panel keeps only the numeric fields and the "Detailed readings"
// disclosure (P7's full time-series table). It still fetches
// getAmplification itself, for that table, independently of whether
// AmplificationCurvePanel is mounted anywhere (see WellDetailPanel.tsx's
// doc comment).
it('keeps compact populated fields visible regardless of the numeric-details disclosure, and fetches the curve for the numeric table', async () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ scatterPoints: [{ well: 'A1', sample_name: 'Sample A', auto_cluster: 'Heterozygous', manual_type: null, confidence: 0.95, norm_fam: 1, norm_allele2: 1, raw_fam: 2, raw_allele2: 2, raw_rox: null }] });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  const { container } = render(<WellDetailPanel />);
  await waitFor(() => expect(getAmplification).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Sample A')).toBeVisible();
  expect(screen.getByText('95%')).toBeVisible();
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false);
  // No curve chart lives in this panel any more.
  expect(container.querySelector('#amplification-plot')).toBeNull();
  details.open = true; fireEvent(details, new Event('toggle'));
  details.open = false; fireEvent(details, new Event('toggle'));
  expect(getAmplification).toHaveBeenCalledTimes(1);
});

// @TASK P7-VALUES - Well detail panel: show the FULL cycle time series, not
// just the single currentCycle row that already existed above.
it('shows the full cycle time series for the selected well, keeping the existing current-cycle table', async () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 2 });
  useDataStore.setState({ scatterPoints: [{ well: 'A1', sample_name: 'Sample A', auto_cluster: 'Heterozygous', manual_type: null, confidence: 0.95, norm_fam: 1, norm_allele2: 1, raw_fam: 2, raw_allele2: 2, raw_rox: null }] });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [1, 2, 3], norm_fam: [0.1, 0.2, 0.3], norm_allele2: [0.9, 0.8, 0.7] }] });
  const { container } = render(<WellDetailPanel />);

  const details = container.querySelector('details')!;
  const seriesTable = await screen.findByTestId('well-timeseries-table');
  details.open = true; fireEvent(details, new Event('toggle'));

  // Existing current-cycle table is untouched.
  expect(screen.getByText('95%')).toBeVisible();

  expect(seriesTable.querySelectorAll('tbody tr')).toHaveLength(3);
  const rows = seriesTable.querySelectorAll('tbody tr');
  expect(rows[0]).toHaveTextContent('0.1');
  expect(rows[1]).toHaveTextContent('0.2');
  expect(rows[2]).toHaveTextContent('0.3');
  // currentCycle (2) row is visually flagged.
  expect(rows[1]).toHaveAttribute('data-current-cycle', 'true');
  expect(rows[0]).not.toHaveAttribute('data-current-cycle');
});

// @TASK P20-STALE-DATA - `curve.well === selectedWell` alone does not catch
// a normalization/background change on the SAME well: a failed re-fetch
// after such a change used to leave the OLD condition's time series
// displayed as if it belonged to the new one, with no visible error.
// @SPEC docs/planning/feedback-2026-09-11/evidence/P20-STALE-DATA.md
it('does not show a stale time series after a same-well condition change whose fetch fails, and shows the error', async () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 3, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 2 });
  useSettingsStore.setState({ useRox: true, backgroundMode: 'none' });
  useDataStore.setState({ scatterPoints: [{ well: 'A1', sample_name: 'Sample A', auto_cluster: 'Heterozygous', manual_type: null, confidence: 0.95, norm_fam: 1, norm_allele2: 1, raw_fam: 2, raw_allele2: 2, raw_rox: null }] });
  vi.mocked(getAmplification).mockResolvedValueOnce({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [1, 2, 3], norm_fam: [0.1, 0.2, 0.3], norm_allele2: [0.9, 0.8, 0.7] }] });
  const { container } = render(<WellDetailPanel />);
  await screen.findByTestId('well-timeseries-table');
  const details = container.querySelector('details')!;
  act(() => { details.open = true; fireEvent(details, new Event('toggle')); });
  expect(screen.getByTestId('well-timeseries-table')).toBeVisible();

  vi.mocked(getAmplification).mockRejectedValueOnce(new Error('Synthetic failure'));
  act(() => useSettingsStore.setState({ backgroundMode: 'channel_min' }));

  await screen.findByRole('alert');
  expect(container.querySelector('[data-testid="well-timeseries-table"]')).toBeNull();
});

it('does not render a time-series table when there is no selected well or no curve data', () => {
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: null });
  useDataStore.setState({ scatterPoints: [] });
  const { container } = render(<WellDetailPanel />);
  expect(container.querySelector('[data-testid="well-timeseries-table"]')).toBeNull();
});

// @TASK P24-DETAIL-CALL - this panel used to fall back to slicing the raw
// FAM/allele2 ratio into a fabricated genotype (>0.6 => Allele 1, <0.4 =>
// Allele 2, else Heterozygous) whenever there was no manual_type/auto_cluster
// at all -- i.e. no call ever ran, or none applies to this well. ResultsTable
// and the export snapshot (result_snapshot.py's `_row_call`) both leave an
// uncalled well as "no call", never guessing a genotype from the ratio.
// @SPEC docs/planning/feedback-2026-09-11/evidence/P22-CALL-LOGIC.md (finding 3)
it('shows no genotype (matching ResultsTable/export) for an uncalled well instead of guessing one from the raw ratio', () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: 'A1' });
  useSettingsStore.setState({ ploidy: 2 });
  // Raw ratio 0.8 -- under the OLD logic this crossed the ">0.6" cut and was
  // displayed as Allele 1, with no call anywhere in the data to back it up.
  const point = { well: 'A1', sample_name: null, norm_fam: 8, norm_allele2: 2,
    raw_fam: 8, raw_allele2: 2, raw_rox: null, auto_cluster: null, manual_type: null };
  useDataStore.setState({ scatterPoints: [point] });
  const { container } = render(<WellDetailPanel />);
  const genotypeRow = container.querySelector('#detail-content > table')!;
  expect(genotypeRow).toHaveTextContent('—');
  expect(genotypeRow).not.toHaveTextContent(en.genotypeAllele1);
  expect(genotypeRow).not.toHaveTextContent(en.genotypeHeterozygous);
});

// @TASK P24-DETAIL-CALL - a REAL call must still render exactly as before;
// only the no-call fallback changed.
it('still shows the real genotype when a call exists, unchanged by the no-call fix', () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: 'A1' });
  useSettingsStore.setState({ ploidy: 2 });
  const point = { well: 'A1', sample_name: null, norm_fam: 8, norm_allele2: 2,
    raw_fam: 8, raw_allele2: 2, raw_rox: null, auto_cluster: 'Heterozygous', manual_type: null };
  useDataStore.setState({ scatterPoints: [point] });
  const { container } = render(<WellDetailPanel />);
  expect(container.querySelector('#detail-content > table')).toHaveTextContent(en.genotypeHeterozygous);
});

// @TASK P24-DETAIL-CALL - `confidence` mixes several different kinds of
// number under one field (mixture-model posterior, manual-boundary distance
// score, a fixed 0.9 small-region ceiling, an NTC-gap score, and the new
// no-signal 0.0 sentinel). The panel cannot tell most of these apart, but it
// can stop the two exact, code-level sentinel constants (0.0 "no basis" and
// the 0.9 small-region ceiling) from being rendered exactly like a measured
// probability. See P24-DETAIL-CALL.md for what this does and does not cover.
it('does not render the no-signal 0.0 confidence sentinel as a plain probability', () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: 'A1' });
  const point = { well: 'A1', sample_name: null, norm_fam: 0, norm_allele2: 0,
    raw_fam: 0, raw_allele2: 0, raw_rox: null, auto_cluster: 'Undetermined', manual_type: null, confidence: 0 };
  useDataStore.setState({ scatterPoints: [point] });
  const { container } = render(<WellDetailPanel />);
  const confidenceCell = container.querySelectorAll('#detail-content > table td')[7];
  expect(confidenceCell).toHaveTextContent('—');
  expect(confidenceCell?.textContent).not.toBe('0%');
});

it('marks the fixed 0.9 small-region confidence ceiling instead of showing it as a plain 90% probability', () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: null, sessionInfo: null });
  useSelectionStore.setState({ selectedWell: 'A1' });
  const point = { well: 'A1', sample_name: null, norm_fam: 8, norm_allele2: 2,
    raw_fam: 8, raw_allele2: 2, raw_rox: null, auto_cluster: 'Allele 1 Homo', manual_type: null, confidence: 0.9 };
  useDataStore.setState({ scatterPoints: [point] });
  const { container } = render(<WellDetailPanel />);
  const confidenceCell = container.querySelectorAll('#detail-content > table td')[7];
  expect(confidenceCell?.textContent).toBe('≥90%');
  expect(confidenceCell?.textContent).not.toBe('90%');
});
