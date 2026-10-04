import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScatterViewControls } from './ScatterViewControls';
import { WellSelectionToolbar } from './WellSelectionToolbar';
import { usePlotViewToggle } from '@/hooks/use-plot-view-toggle';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useLanguageStore } from '@/stores/language-store';

const props = {
  dataBounds: { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
  labels: { fam: 'FAM', allele2: 'VIC', normalization: 'ROX' },
  ntcCorner: null,
  effectiveNtcCorner: { fam: 0.12, allele2: 0.34 },
  onNtcCornerChange: vi.fn(),
  normalizationApplied: false,
};

beforeEach(() => {
  useLanguageStore.getState().setLanguage('en');
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ expertMode: false });
  useSelectionStore.getState().clearSelection();
});

it('keeps only aspect, swap axes and fit in the basic scatter header', () => {
  render(<ScatterViewControls {...props} />);
  expect(screen.getByTestId('scatter-aspect-select')).toBeInTheDocument();
  expect(screen.getByTestId('scatter-swap-axes')).toBeInTheDocument();
  for (const id of ['scatter-tool-select', 'scatter-tool-edit', 'scatter-use-rox', 'normalization-channel-select',
    'axis-mode', 'axis-lock-aspect', 'axis-settings-toggle', 'analysis-advanced-settings']) {
    expect(screen.queryByTestId(id), id).toBeNull();
  }
});

it('shows the full scatter header in expert mode', () => {
  useSettingsStore.getState().setExpertMode(true);
  render(<ScatterViewControls {...props} />);
  for (const id of ['scatter-tool-select', 'scatter-tool-edit', 'scatter-use-rox', 'normalization-channel-select',
    'axis-mode', 'axis-lock-aspect', 'axis-settings-toggle', 'analysis-advanced-settings']) {
    expect(screen.getByTestId(id), id).toBeInTheDocument();
  }
});

it('hides the selection toolbar until wells are selected and keeps group tools expert-only', () => {
  const { rerender } = render(<WellSelectionToolbar />);
  expect(screen.queryByTestId('analysis-selection-toolbar')).toBeNull();
  act(() => useSelectionStore.getState().selectWells(['A1', 'A2']));
  rerender(<WellSelectionToolbar />);
  expect(screen.getByTestId('analysis-selection-count')).toBeInTheDocument();
  expect(screen.queryByTestId('scatter-selected-only')).toBeNull();
  expect(screen.queryByTestId('manual-group-trigger')).toBeNull();
  act(() => useSettingsStore.getState().setExpertMode(true));
  expect(screen.getByTestId('scatter-selected-only')).toBeInTheDocument();
  expect(screen.getByTestId('manual-group-trigger')).toBeInTheDocument();
});

it('offers the scatter/curve switch in basic mode too', () => {
  const { result } = renderHook(() => usePlotViewToggle());
  expect(result.current.toggle).not.toBeNull();
  expect(result.current.view).toBe('scatter');
  act(() => useSettingsStore.getState().setExpertMode(true));
  expect(result.current.toggle).not.toBeNull();
});
