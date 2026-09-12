import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';

// P4-S1-T1 (FB-04 §3-1): same contract as ScatterPlot.aspect.test.tsx, for
// the per-marker plot -- the two share `.analysis-scatter-canvas` and must
// both honor scatterAspect (06-tasks.md P4-S1-T1: "두 플롯이 같은 클래스를
// 공유하므로 함께 검증한다").
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'M1', wells: ['A1'], ploidy: 2 };
const point = { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null,
  norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null };

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSettingsStore.getState().resetToDefaults();
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
});

function renderPlot() {
  return render(<MarkerScatterPlot sessionId="run-a" marker={marker} region={undefined}
    points={[point]} scatterProvenance={{ cycle: 1, useRox: false, backgroundMode: 'none' }}
    onBoundariesPersisted={vi.fn()} />);
}

it('renders the canvas at the default 4:3 aspect', async () => {
  const view = renderPlot();
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  const canvas = view.getByTestId('marker-scatter');
  expect(canvas.style.getPropertyValue('--scatter-aspect-w')).toBe('4');
  expect(canvas.style.getPropertyValue('--scatter-aspect-h')).toBe('3');
});

it('switches the canvas to 1:1 when scatterAspect changes', async () => {
  const view = renderPlot();
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  const canvas = view.getByTestId('marker-scatter');
  await waitFor(() => {
    expect(canvas.style.getPropertyValue('--scatter-aspect-w')).toBe('1');
    expect(canvas.style.getPropertyValue('--scatter-aspect-h')).toBe('1');
  });
});

it('forces a Plotly resize after the initial mount when the aspect toggles', async () => {
  renderPlot();
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalled());
  expect(Plotly.Plots.resize).not.toHaveBeenCalled();
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  await waitFor(() => expect(Plotly.Plots.resize).toHaveBeenCalledTimes(1));
});

it('does not force a resize before the initial Plotly.newPlot has resolved', () => {
  vi.mocked(Plotly.newPlot).mockImplementation(() => new Promise(() => {})); // never resolves
  renderPlot();
  act(() => useSettingsStore.getState().setScatterAspect('1:1'));
  expect(Plotly.Plots.resize).not.toHaveBeenCalled();
});
