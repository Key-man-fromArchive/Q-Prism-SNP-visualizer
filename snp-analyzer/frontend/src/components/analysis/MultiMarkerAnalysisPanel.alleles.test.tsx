import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MultiMarkerAnalysisPanel } from './MultiMarkerAnalysisPanel';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';
import type { MarkerRegion, ScatterPoint } from '@/types/api';

const seen = vi.hoisted(() => ({
  plate: [] as Record<string, unknown>[],
  detail: [] as Record<string, unknown>[],
  table: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/api', () => ({
  getScatter: vi.fn().mockResolvedValue({ points: [], allele2_dye: 'VIC' }),
  listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }),
}));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./MarkerScatterPlot', () => ({ MarkerScatterPlot: () => null }));
vi.mock('./WellSelectionToolbar', () => ({ WellSelectionToolbar: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));
vi.mock('./PlateView', () => ({ PlateView: (p: Record<string, unknown>) => { seen.plate.push(p); return null; } }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: (p: Record<string, unknown>) => { seen.detail.push(p); return null; } }));
vi.mock('./ResultsTable', () => ({ ResultsTable: (p: Record<string, unknown>) => { seen.table.push(p); return null; } }));

const named: MarkerRegion = { id: 'm1', name: 'M1', wells: ['A1'], ploidy: 2, color: '#000000', allele_labels: { fam: 'WT', allele2: 'MT' } };
const unnamed: MarkerRegion = { id: 'm2', name: 'M2', wells: ['A2'], ploidy: 2, color: '#111111' };

function point(well: string): ScatterPoint {
  return { well, norm_fam: 1, norm_allele2: 1, raw_fam: 1, raw_allele2: 1, raw_rox: null, ratio: 0.5,
    sample_name: null, auto_cluster: null, manual_type: null, confidence: null } as unknown as ScatterPoint;
}

beforeEach(() => {
  seen.plate.length = 0; seen.detail.length = 0; seen.table.length = 0;
  useSessionStore.setState({ sessionId: 'alleles', initialAnalysisAvailable: false });
  useAnalysisStore.getState().setSession('alleles', 'u');
  useNavigationStore.setState({ status: 'ready', surface: 'analysis', marker: null });
  useDataStore.setState({ scatterPoints: [point('A1'), point('A2'), point('A3'), point('A4')] });
});

it('passes the selected marker allele names and the marker-unassigned wells to the tables and plate', () => {
  render(<MultiMarkerAnalysisPanel markers={[named, unnamed]} />);
  const last = <T,>(list: T[]) => list[list.length - 1];
  expect(last(seen.table)).toMatchObject({ alleleLabels: { fam: 'WT', allele2: 'MT' } });
  expect(last(seen.detail)).toMatchObject({ alleleLabels: { fam: 'WT', allele2: 'MT' } });
  expect(last(seen.plate)).toMatchObject({ alleleLabels: { fam: 'WT', allele2: 'MT' }, unassignedWells: ['A3', 'A4'] });
});
