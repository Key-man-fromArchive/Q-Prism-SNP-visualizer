import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlateLegend } from './PlateLegend';
import { PlateView } from './PlateView';
import { ResultsTable } from './ResultsTable';
import { WellDetailPanel } from './WellDetailPanel';
import { WellTypePopup } from './WellTypePopup';
import { getPlate } from '@/lib/api';
import en from '@/locales/en';
import { useLanguageStore } from '@/stores/language-store';
import { useDataStore } from '@/stores/data-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSessionStore } from '@/stores/session-store';
import type { PlateWell, ScatterPoint } from '@/types/api';

vi.mock('@/lib/api', () => ({
  getPlate: vi.fn(),
  getAmplification: vi.fn().mockResolvedValue({ curves: [] }),
}));

vi.mock('@/hooks/use-well-filter', () => ({
  useWellFilter: () => ({
    visibleRows: ['A'], visibleCols: [1, 2, 3], plateRows: ['A'], plateCols: [1, 2, 3], isWellVisible: () => true,
  }),
}));

const NAMES ={ fam: 'WT', allele2: 'MT' };

function plateWell(well: string, manual_type: string | null): PlateWell {
  return { well, row: 0, col: 0, norm_fam: 1, norm_allele2: 1, ratio: 0.5, sample_name: null, auto_cluster: null, manual_type };
}

function point(well: string, manual_type: string | null): ScatterPoint {
  return {
    well, norm_fam: 1, norm_allele2: 1, raw_fam: 1, raw_allele2: 1, raw_rox: null, ratio: 0.5,
    sample_name: null, auto_cluster: null, manual_type, confidence: null,
  } as unknown as ScatterPoint;
}

beforeEach(() => {
  useLanguageStore.getState().setLanguage('en');
  useSelectionStore.getState().clearSelection();
});

it('legend shows allele names for diploid calls and the old text without names', () => {
  const wells = [plateWell('A1', 'Allele 1 Homo'), plateWell('A2', 'Heterozygous'), plateWell('A3', 'Allele 2 Homo')];
  const { rerender } = render(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} alleleLabels={NAMES} />);
  const list = screen.getByRole('list', { name: en.plateLegendAria });
  expect(list).toHaveTextContent('WT/WT');
  expect(list).toHaveTextContent('WT/MT');
  expect(list).toHaveTextContent('MT/MT');
  rerender(<PlateLegend wells={wells} showManualTypes showAutoCluster ploidy={2} dark={false} />);
  expect(screen.getByRole('list', { name: en.plateLegendAria })).not.toHaveTextContent('WT/WT');
  expect(screen.getByRole('list', { name: en.plateLegendAria })).toHaveTextContent('Het');
});

it('results table cells use allele names and keep the old label without names', () => {
  useDataStore.setState({ scatterPoints: [point('A1', 'Allele 1 Homo')] });
  const { rerender } = render(<ResultsTable ploidyOverride={2} alleleLabels={NAMES} />);
  expect(screen.getByRole('gridcell', { name: /^A1, WT\/WT/ })).toHaveTextContent('WT/WT');
  rerender(<ResultsTable ploidyOverride={2} />);
  expect(screen.getByRole('gridcell', { name: /^A1, / })).toHaveTextContent('Hom-1');
  expect(screen.queryByText('WT/WT')).not.toBeInTheDocument();
});

it('well detail genotype row uses allele names', () => {
  useDataStore.setState({ scatterPoints: [point('A1', 'Heterozygous')] });
  act(() => useSelectionStore.getState().selectWell('A1'));
  render(<WellDetailPanel ploidyOverride={2} alleleLabels={NAMES} />);
  expect(screen.getAllByText('WT/MT').length).toBeGreaterThan(0);
});

it('well type popup names the diploid classes after the marker alleles', () => {
  render(<WellTypePopup wells={['A1']} position={{ x: 0, y: 0 }} onAssign={() => {}} onClose={() => {}} alleleLabels={NAMES} />);
  const menu = screen.getByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'WT/WT' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'WT/MT' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'MT/MT' })).toBeInTheDocument();
});

it('plate view greys marker-unassigned wells and states their count', async () => {
  vi.mocked(getPlate).mockResolvedValue({ cycle: 0, allele2_dye: 'VIC', wells: [
    plateWell('A1', 'Allele 1 Homo'), plateWell('A2', 'Allele 1 Homo'), plateWell('A3', 'Allele 1 Homo'),
  ] });
  useSessionStore.setState({ sessionId: 'unassigned' });
  const view = render(<PlateView scopeWells={['A1']} unassignedWells={['A2', 'A3']} ploidyOverride={2} alleleLabels={NAMES} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('plate-unassigned-note')).toHaveTextContent(en.genotypeDisplayUnassignedCount(2));
  const grey = view.container.querySelector<HTMLElement>('[data-well="A2"]')!;
  const coloured = view.container.querySelector<HTMLElement>('[data-well="A1"]')!;
  expect(grey.dataset.unassigned).toBe('true');
  expect(grey.style.backgroundColor).not.toBe(coloured.style.backgroundColor);
  expect(coloured.dataset.unassigned).toBeUndefined();
  expect(view.container.querySelector('[data-well="A1"]')!.getAttribute('aria-label')).toContain('WT/WT');
});

it('plate view shows no unassigned note when every well belongs to a marker', async () => {
  vi.mocked(getPlate).mockResolvedValue({ cycle: 0, allele2_dye: 'VIC', wells: [plateWell('A1', null)] });
  useSessionStore.setState({ sessionId: 'assigned' });
  render(<PlateView scopeWells={['A1']} unassignedWells={[]} ploidyOverride={2} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId('plate-unassigned-note')).not.toBeInTheDocument();
});
