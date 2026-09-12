// @TASK P4-S3-T1 - Conditional group-preset rendering (FB-03 §3-2)
// @SPEC docs/planning/feedback-2026-09-11/FB-03-analysis-density.md §3-2
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WellSelectionToolbar } from './WellSelectionToolbar';
import { getWellGroups } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('@/lib/api', () => ({
  getWellGroups: vi.fn().mockResolvedValue({ groups: {} }),
  createWellGroup: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWellGroups).mockResolvedValue({ groups: {} });
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', wellGroups: null });
  useSelectionStore.setState({ selectedWells: [], selectedGroup: null, focusSelectedWells: false });
});

it('hides the group-preset buttons on a plate with no manual groups and no selection', async () => {
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  expect(screen.queryByTestId('manual-group-presets')).not.toBeInTheDocument();
  expect(screen.queryByTestId('manual-group-1')).not.toBeInTheDocument();
  // "+ Add group" always remains -- it is the only way to create the first one.
  expect(screen.getByRole('button', { name: /Add group/i })).toBeInTheDocument();
});

it('reveals the preset buttons once wells are selected (they become valid save targets)', async () => {
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  expect(screen.getByTestId('manual-group-presets')).toBeInTheDocument();
  expect(screen.getByTestId('manual-group-1')).toBeInTheDocument();
});

it('reveals a previously-saved manual group as a filter even with nothing selected', async () => {
  vi.mocked(getWellGroups).mockResolvedValue({ groups: { 'Group 1': { wells: ['A1'], source: 'manual' } } });
  render(<WellSelectionToolbar />);
  await screen.findByTestId('manual-group-presets');
  expect(screen.getByTestId('manual-group-1')).toBeInTheDocument();
});
