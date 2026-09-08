import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { WellDetailPanel } from './WellDetailPanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { getAmplification } from '@/lib/api';
import en from '@/locales/en';
import ko from '@/locales/ko';
import { useSettingsStore } from '@/stores/settings-store';
vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), relayout: vi.fn(), purge: vi.fn() } }));
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
    expect(screen.getByText(t.referenceBasisUnknown)).toBeVisible();
  });
}
it('keeps compact populated fields visible and resizes the retained curve on disclosure without another request', async () => {
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 1, num_cycles: 2, has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null } });
  useSelectionStore.setState({ selectedWell: 'A1', currentCycle: 40 });
  useDataStore.setState({ scatterPoints: [{ well: 'A1', sample_name: 'Sample A', auto_cluster: 'Heterozygous', manual_type: null, confidence: 0.95, norm_fam: 1, norm_allele2: 1, raw_fam: 2, raw_allele2: 2, raw_rox: null }] });
  vi.mocked(getAmplification).mockResolvedValue({ allele2_dye: 'VIC', curves: [{ well: 'A1', cycles: [20, 40], norm_fam: [0, 1], norm_allele2: [0, 1] }] });
  const { container } = render(<WellDetailPanel />);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(screen.getByText('Sample A')).toBeVisible();
  expect(screen.getByText('95%')).toBeVisible();
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false);
  const plot = container.querySelector('#amplification-plot');
  details.open = true; fireEvent(details, new Event('toggle'));
  expect(screen.getByText(en.referenceBasisUnknown)).toBeVisible();
  expect(Plotly.relayout).toHaveBeenCalledWith(plot, { autosize: true });
  details.open = false; fireEvent(details, new Event('toggle'));
  expect(container.querySelector('#amplification-plot')).toBe(plot);
  expect(getAmplification).toHaveBeenCalledTimes(1);
});
