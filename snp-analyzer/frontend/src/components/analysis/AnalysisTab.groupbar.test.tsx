// @TASK P4-S3-T1 followup3 - Merge the redundant group bars (FB-03)
// @SPEC docs/planning/feedback-2026-09-11/FB-03-analysis-density.md, feedback `2d1ca7ee9f444564`
//
// AnalysisTab used to render its own "Group Filter Bar" directly above
// WellSelectionToolbar. With no groups and no selection, that bar's only
// content was a "+ Group" button stacked right on top of WellSelectionToolbar's
// own "+ Add group" -- two bars whose sole purpose, in that state, was the
// same "create a group" action. These tests exercise the real (unmocked)
// WellSelectionToolbar to verify the two bars are now one row.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalysisTab } from './AnalysisTab';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useDataStore } from '@/stores/data-store';
import { getWellGroups } from '@/lib/api';

vi.mock('@/lib/api', async original => ({
  ...await original<typeof import('@/lib/api')>(),
  getWellGroups: vi.fn().mockResolvedValue({ groups: {} }),
  getWellTypes: vi.fn().mockResolvedValue({ assignments: {}, manual_assignments: {}, input_revision: 0 }),
  getCluster: vi.fn(), getPloidy: vi.fn(), runClustering: vi.fn(), suggestCycle: vi.fn(),
}));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./ScatterPlot', () => ({ ScatterPlot: () => null }));
vi.mock('./AmplificationCurvePanel', () => ({ AmplificationCurvePanel: () => null }));
vi.mock('./PlateView', () => ({ PlateView: () => null }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: () => null }));
vi.mock('./ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));
vi.mock('./WellTypePopup', () => ({ WellTypePopup: () => null }));
// GroupManager makes its own API calls on mount; a mock is enough to prove
// the "manage groups" wiring reaches it without pulling in that surface.
vi.mock('./GroupManager', () => ({ GroupManager: () => <div data-testid="group-manager-mock" /> }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWellGroups).mockResolvedValue({ groups: {} });
  useSessionStore.getState().reset();
  useLanguageStore.getState().setLanguage('en');
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 'group-bar-fixture', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 0, selectedWells: [], selectedGroup: null });
  useSettingsStore.setState({ showEmptyWells: false });
  useDataStore.setState({ wellTypeAssignments: {} });
  useAnalysisStore.getState().setSession('group-bar-fixture', 'u');
  useAnalysisStore.getState().updateInputRevision('group-bar-fixture', 'u', 0);
  useNavigationStore.setState({ session: 'group-bar-fixture', tab: 'analysis', status: 'ready', exportRestoring: false });
});

// State (a): no groups defined, nothing selected.
it('merges into a single row with one "create a group" entry point when there are no groups and nothing selected', () => {
  render(<AnalysisTab />);
  const toolbars = screen.getAllByTestId('analysis-selection-toolbar');
  expect(toolbars).toHaveLength(1);
  expect(screen.queryByTestId('well-group-filter')).not.toBeInTheDocument();
  expect(screen.queryByTestId('manage-groups-button')).not.toBeInTheDocument();
  expect(screen.queryByTestId('manual-group-trigger')).not.toBeInTheDocument();
  expect(screen.queryByTestId('show-empty-wells-toggle')).not.toBeInTheDocument();
  // Exactly one way left to create the first group.
  expect(screen.getByRole('button', { name: /Add group/i })).toBeInTheDocument();
});

// State (b): a selection exists.
it('shows the group-assign trigger and an accurate selection count once wells are selected', () => {
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  render(<AnalysisTab />);
  // P15-GROUP-MENU: the 6 preset buttons collapsed into one trigger + menu.
  expect(screen.getByTestId('manual-group-trigger')).toBeInTheDocument();
  expect(screen.getByTestId('analysis-selection-count')).toHaveTextContent('2');
  expect(screen.getByTestId('scatter-selected-only')).not.toBeDisabled();
});

// State (c): a manual group already exists (no selection needed to see it).
it('keeps the parsed/manual group filter dropdown mandatory once groups exist, alongside the manage-groups entry', () => {
  useSessionStore.setState({ wellGroups: { 'Group A': ['A1', 'A2'] } });
  render(<AnalysisTab />);
  const select = screen.getByTestId('well-group-filter');
  expect(select).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Group A \(2\)/ })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('manage-groups-button'));
  expect(screen.getByTestId('group-manager-mock')).toBeInTheDocument();
});

it('shows the empty-wells toggle in the same row once an Empty well exists', () => {
  useDataStore.setState({ wellTypeAssignments: { A1: 'Empty' } });
  render(<AnalysisTab />);
  const toggle = screen.getByTestId('show-empty-wells-toggle');
  expect(toggle.querySelector('input')).not.toBeChecked();
  fireEvent.click(toggle.querySelector('input')!);
  expect(useSettingsStore.getState().showEmptyWells).toBe(true);
});
