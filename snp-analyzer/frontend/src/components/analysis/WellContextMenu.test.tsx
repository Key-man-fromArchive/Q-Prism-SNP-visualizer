import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MultiMarkerAnalysisPanel } from './MultiMarkerAnalysisPanel';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { MarkerRegion, ScatterPoint } from '@/types/api';

// Right-click popup restored in the marker view: only the plate grid and the
// scatter plot intercept it, and a scatter point targets itself via the
// hovered-well attribute Plotly's hover event writes onto the plot container.
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), relayout: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('@/lib/api', () => ({
  getScatter: vi.fn().mockResolvedValue({ points: [], allele2_dye: 'VIC' }),
  listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }),
}));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./MarkerScatterPlot', () => ({
  MarkerScatterPlot: () => <div data-testid="scatter-stub" data-well-context data-hover-well="A2" />,
}));
vi.mock('./WellSelectionToolbar', () => ({ WellSelectionToolbar: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: () => null }));
vi.mock('./ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('./PlateView', () => ({
  PlateView: () => <div data-testid="plate-stub" data-well-context><span data-testid="well-A1" data-well="A1" /></div>,
}));

const marker: MarkerRegion = { id: 'm1', name: 'M1', wells: ['A1', 'A2'], ploidy: 2, color: '#000000', allele_labels: { fam: 'Wildtype', allele2: 'Mutant' } };

function point(well: string): ScatterPoint {
  return { well, norm_fam: 1, norm_allele2: 1, raw_fam: 1, raw_allele2: 1, raw_rox: null, ratio: 0.5,
    sample_name: null, auto_cluster: null, manual_type: null, confidence: null } as unknown as ScatterPoint;
}

function rightClick(node: Element) {
  const event = createEvent.contextMenu(node, { cancelable: true });
  fireEvent(node, event);
  return event;
}

beforeEach(() => {
  useSettingsStore.setState({ expertMode: false });
  useSessionStore.setState({ sessionId: 'ctx', initialAnalysisAvailable: false });
  useAnalysisStore.getState().setSession('ctx', 'u');
  useNavigationStore.setState({ status: 'ready', surface: 'analysis', marker: null });
  useDataStore.setState({ scatterPoints: [point('A1'), point('A2')] });
  useSelectionStore.setState({ selectedWells: [], selectedGroup: null });
});

it('opens the popup from a plate well in the marker panel, showing the marker allele names', () => {
  render(<MultiMarkerAnalysisPanel markers={[marker]} />);
  const event = rightClick(screen.getByTestId('well-A1'));
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menu').textContent).toContain('Wildtype');
});

it('targets the hovered scatter point when nothing is selected', () => {
  render(<MultiMarkerAnalysisPanel markers={[marker]} />);
  const event = rightClick(screen.getByTestId('scatter-stub'));
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByRole('menu')).toBeInTheDocument();
});

it('targets the selection when right-clicking inside the plate or scatter', () => {
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  render(<MultiMarkerAnalysisPanel markers={[marker]} />);
  expect(rightClick(screen.getByTestId('plate-stub')).defaultPrevented).toBe(true);
  expect(screen.getByRole('menu')).toBeInTheDocument();
});

it('leaves the browser menu alone outside the plate and scatter, even with a selection', () => {
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  const { container } = render(<MultiMarkerAnalysisPanel markers={[marker]} />);
  const event = rightClick(container.firstElementChild!);
  expect(event.defaultPrevented).toBe(false);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('leaves the browser menu alone on an empty plate spot with no selection', () => {
  render(<MultiMarkerAnalysisPanel markers={[marker]} />);
  expect(rightClick(screen.getByTestId('plate-stub')).defaultPrevented).toBe(false);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('MarkerScatterPlot mirrors the hovered well onto its container and clears it on unhover', async () => {
  const actual = await vi.importActual<typeof import('./MarkerScatterPlot')>('./MarkerScatterPlot');
  const handlers: Record<string, (data?: unknown) => void> = {};
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => {
    Object.assign(node, {
      on: (name: string, cb: (data?: unknown) => void) => { handlers[name] = cb; },
      layout: {}, data: [],
    });
  });
  const Real = actual.MarkerScatterPlot as typeof MarkerScatterPlot;
  render(<Real sessionId="ctx" marker={marker} region={undefined} points={[point('A1'), point('A2')]}
    scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }} onBoundariesPersisted={vi.fn()} />);
  await waitFor(() => expect(handlers.plotly_hover).toBeTypeOf('function'));
  const plot = screen.getByTestId('marker-scatter');
  act(() => handlers.plotly_hover({ points: [{ customdata: 'A2' }] }));
  expect(plot.getAttribute('data-hover-well')).toBe('A2');
  act(() => handlers.plotly_unhover());
  expect(plot.hasAttribute('data-hover-well')).toBe(false);
});
