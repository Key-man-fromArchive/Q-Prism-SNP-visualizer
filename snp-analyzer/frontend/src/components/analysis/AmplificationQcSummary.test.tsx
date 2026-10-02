import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { AmplificationQcSummary } from './AmplificationQcSummary';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useQcUiStore } from '@/stores/qc-ui-store';
import type { AmplificationQcResult } from '@/types/api';

const qc: AmplificationQcResult = {
  enabled: true, available: true, fraction: 1 / 3, fam_threshold: 1.2, allele2_threshold: 0.1,
  source: 'auto', baseline_cycle: 0, read_cycle: 2, no_amplification_wells: ['A1'],
};
const withQc = (patch: Partial<AmplificationQcResult>) =>
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 1, assignments: {}, amplification_qc: { ...qc, ...patch } } });

const savedQc = () => useQcUiStore.getState().bySession[''].settings;

beforeEach(() => {
  useQcUiStore.setState({ bySession: {} });
  useLanguageStore.getState().setLanguage('en');
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ expertMode: false });
  useDataStore.setState({ allele2Dye: 'VIC', channelLabels: null });
  withQc({});
});

it('states the applied thresholds with the real channel labels and no controls by default', () => {
  render(<AmplificationQcSummary />);
  expect(screen.getByTestId('amplification-qc-summary'))
    .toHaveTextContent('Amplification threshold FAM ≥ 1.20 · VIC ≥ 0.10 (auto, 1/3 of the top 10%)');
  expect(screen.queryByTestId('amplification-qc-controls')).toBeNull();
});

it('names only the dyes in the summary even when the run has WT/MT role labels', () => {
  useDataStore.setState({ allele2Dye: 'HEX', channelLabels: { fam: 'WT (FAM)', allele2: 'MT1 (HEX)', normalization: null } });
  render(<AmplificationQcSummary />);
  expect(screen.getByTestId('amplification-qc-summary'))
    .toHaveTextContent('Amplification threshold FAM ≥ 1.20 · HEX ≥ 0.10 (auto, 1/3 of the top 10%)');
});

it('says the threshold was set by hand when a manual value is used', () => {
  withQc({ source: 'manual' });
  render(<AmplificationQcSummary />);
  expect(screen.getByTestId('amplification-qc-summary')).toHaveTextContent('(manual)');
});

it('says the check is off when it is disabled', () => {
  withQc({ enabled: false, source: 'off' });
  render(<AmplificationQcSummary />);
  expect(screen.getByTestId('amplification-qc-summary')).toHaveTextContent('Amplification check off');
});

const openControls = () => {
  if (!screen.queryByTestId('amplification-qc-controls')) fireEvent.click(screen.getByTestId('qc-adjust'));
};

it('keeps the expert editor collapsed behind an Adjust button until it is opened, and remembers it', () => {
  useSettingsStore.setState({ expertMode: true });
  const first = render(<AmplificationQcSummary />);
  expect(screen.queryByTestId('amplification-qc-controls')).toBeNull();
  fireEvent.click(screen.getByTestId('qc-adjust'));
  expect(screen.getByTestId('amplification-qc-controls')).toBeInTheDocument();
  first.unmount();
  render(<AmplificationQcSummary />);
  expect(screen.getByTestId('amplification-qc-controls')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('qc-adjust'));
  expect(screen.queryByTestId('amplification-qc-controls')).toBeNull();
});

it('lets an expert switch the check off, set the fraction and type manual thresholds into the saved settings', () => {
  useSettingsStore.setState({ expertMode: true });
  render(<AmplificationQcSummary />);
  openControls();
  fireEvent.change(screen.getByTestId('qc-fraction'), { target: { value: '0.5' } });
  fireEvent.change(screen.getByTestId('qc-fam-threshold'), { target: { value: '2.5' } });
  expect(savedQc()).toMatchObject({ fraction: 0.5, famThreshold: 2.5, allele2Threshold: null });
  fireEvent.change(screen.getByTestId('qc-fam-threshold'), { target: { value: '' } });
  expect(savedQc().famThreshold).toBeNull();
  fireEvent.click(screen.getByTestId('qc-enabled'));
  expect(savedQc().enabled).toBe(false);
});

it('keeps the fraction inside 0.05–0.9', () => {
  useSettingsStore.setState({ expertMode: true });
  render(<AmplificationQcSummary />);
  openControls();
  fireEvent.change(screen.getByTestId('qc-fraction'), { target: { value: '5' } });
  expect(savedQc().fraction).toBe(0.9);
  fireEvent.change(screen.getByTestId('qc-fraction'), { target: { value: '0.01' } });
  expect(savedQc().fraction).toBe(0.05);
});

it('keeps the editor open across a remount (marker switch / re-analysis)', async () => {
  useSettingsStore.setState({ expertMode: true });
  const first = render(<AmplificationQcSummary />);
  fireEvent.click(screen.getByTestId('qc-adjust'));
  expect(screen.getByTestId('qc-enabled')).toBeTruthy();
  first.unmount();
  withQc({ source: 'manual' });
  render(<AmplificationQcSummary />);
  expect(screen.getByTestId('qc-enabled')).toBeTruthy();
  expect(useQcUiStore.getState().bySession[''].open).toBe(true);
});
