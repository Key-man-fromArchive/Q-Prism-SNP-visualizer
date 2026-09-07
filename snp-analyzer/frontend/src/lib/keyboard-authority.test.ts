import { beforeEach, expect, it } from 'vitest';
import { keyboardCanExecute } from './keyboard-authority';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSelectionStore } from '@/stores/selection-store';

beforeEach(() => {
  useNavigationStore.getState().clear();
  useAnalysisStore.getState().clear();
  useSelectionStore.getState().clearSelection();
  useSessionStore.setState({ sessionId: 'keyboard-session' });
  useNavigationStore.setState({ session: 'keyboard-session', status: 'ready', availableCycles: [0, 10, 40] });
  useAnalysisStore.getState().setSession('keyboard-session', 'owner');
});
it('requires a selection for mutations and preserves theme/help outside analysis', () => {
  expect(keyboardCanExecute('assignWellType')).toBe(false);
  useSelectionStore.getState().selectWell('A1');
  expect(keyboardCanExecute('assignWellType')).toBe(true);
  useNavigationStore.getState().setTab('settings');
  for (const action of ['assignWellType', 'togglePlay', 'nextCycle', 'exportCSV'] as const) {
    expect(keyboardCanExecute(action)).toBe(false);
  }
  expect(keyboardCanExecute('help')).toBe(true);
  expect(keyboardCanExecute('toggleDarkMode')).toBe(true);
});
it.each(['restoring', 'error'] as const)('blocks all analysis shortcuts when navigation is %s', status => {
  useNavigationStore.setState({ status });
  expect(keyboardCanExecute('togglePlay')).toBe(false);
});
it('blocks pending, refresh and export restoration without requiring a current result for navigation', () => {
  expect(keyboardCanExecute('nextCycle')).toBe(true);
  expect(keyboardCanExecute('exportCSV')).toBe(false);
  useAnalysisStore.setState({ pending: true });
  expect(keyboardCanExecute('nextCycle')).toBe(false);
  useAnalysisStore.setState({ pending: false, inputRevisionRefreshing: true });
  expect(keyboardCanExecute('nextCycle')).toBe(false);
  useAnalysisStore.setState({ inputRevisionRefreshing: false });
  useNavigationStore.setState({ exportRestoring: true });
  expect(keyboardCanExecute('nextCycle')).toBe(false);
});
