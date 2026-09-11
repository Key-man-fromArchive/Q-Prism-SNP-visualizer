import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { useAuthStore } from '@/stores/auth-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';

vi.mock('@/lib/api', () => ({
  getVersion: vi.fn(async () => ({ version: '1.0.0', commit: '', built_at: '' })), getAuthConfig: vi.fn(() => new Promise(() => {})), getMe: vi.fn(), asgLaunch: vi.fn(), asgLaunchCookie: vi.fn(), setWellTypes: vi.fn() }));
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/upload/UploadZone', () => ({ UploadZone: ({ onGoToProject }: { onGoToProject: () => void }) => <button onClick={onGoToProject}>Open project</button> }));
vi.mock('@/components/batch/BatchTab', () => ({ BatchTab: () => <div>Synthetic projects</div> }));
vi.mock('@/components/analysis/AnalysisWorkspace', () => ({ AnalysisWorkspace: () => <div>Analysis ready</div> }));
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ toggle: vi.fn() }), useIsDarkMode: () => false }));
vi.mock('plotly.js-dist-min', () => ({ default: {} }));
vi.mock('@/hooks/use-exports', () => ({ useExports: () => ({ downloadCSV: vi.fn() }) }));
vi.mock('@/hooks/use-undo-redo', () => ({ useUndoRedo: () => ({ undo: vi.fn(), redo: vi.fn() }) }));
beforeEach(() => history.replaceState(null, '', '/'));
it('uses navigation ownership and disconnects its result projection on unmount', async () => {
  useAuthStore.getState().setUser({ id: 'u', username: 'synthetic', display_name: null, role: 'user' });
  useNavigationStore.getState().clear();
  const view = render(<App />);
  fireEvent.click(screen.getByText('Open project'));
  expect(useNavigationStore.getState().tab).toBe('project');
  expect(screen.getByText('Synthetic projects')).toBeInTheDocument();
  for (const tab of screen.getAllByRole('tab')) {
    const controlled = document.getElementById(tab.getAttribute('aria-controls')!);
    expect(controlled).not.toBeNull();
    expect(controlled?.getAttribute('aria-labelledby')).toBe(tab.id);
  }
  act(() => {
    useAnalysisStore.getState().setSession('s', 'u');
    useAnalysisStore.getState().accept(useAnalysisStore.getState().beginRequest('analysis'), {
      algorithm: 'auto', cycle: 20, assignments: { A1: 'NTC' },
    });
  });
  expect(useDataStore.getState().clusterAssignments).toEqual({ A1: 'NTC' });
  view.unmount();
  act(() => useAnalysisStore.getState().clear());
  expect(useDataStore.getState().clusterAssignments).toEqual({ A1: 'NTC' });
});

it('routes real background shortcut events through actual sparse cycles and stops at both endpoints', () => {
  useAuthStore.getState().setUser({ id: 'u', username: 'synthetic', display_name: null, role: 'user' });
  useSessionStore.setState({ sessionId: 'keyboard-run', sessionInfo: null });
  useAnalysisStore.getState().setSession('keyboard-run', 'u');
  useNavigationStore.setState({ session: 'keyboard-run', tab: 'analysis', status: 'ready',
    availableCycles: [0, 10, 40], cycle: 10, exportRestoring: false });
  render(<App />);
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(useSelectionStore.getState().currentCycle).toBe(0);
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(useNavigationStore.getState().cycle).toBe(0);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(useNavigationStore.getState().cycle).toBe(10);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(useNavigationStore.getState().cycle).toBe(40);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(useNavigationStore.getState().cycle).toBe(40);
  act(() => useNavigationStore.getState().setTab('project'));
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(useNavigationStore.getState().cycle).toBe(40);
});
it('sends the export shortcut to the Header flow and blocks it while analysis is pending', () => {
  useAuthStore.getState().setUser({ id: 'u', username: 'synthetic', display_name: null, role: 'user' });
  useSessionStore.setState({ sessionId: 'export-run', sessionInfo: null });
  useAnalysisStore.getState().setSession('export-run', 'u');
  useAnalysisStore.setState({ currentInputRevision: 0, result: { algorithm: 'auto', cycle: 40, assignments: {},
    analysis_context: { schema_version: 1, result_revision: '11111111-1111-4111-8111-111111111111',
      analysed_at: '2026-09-07T00:00:00Z', cycle: 40, use_rox: false, normalization_applied: false,
      background: 'none', algorithm: 'auto', input_revision: 0, regions: [], parameters: {} } } });
  useNavigationStore.setState({ session: 'export-run', tab: 'analysis', status: 'ready', cycle: 40, exportRestoring: false });
  const exported = vi.fn();
  window.addEventListener('keyboard-export-csv', exported);
  const view = render(<App />);
  const primary = navigator.platform.toUpperCase().includes('MAC') ? { metaKey: true } : { ctrlKey: true };
  fireEvent.keyDown(document.body, { key: 'e', ...primary });
  expect(exported).toHaveBeenCalledTimes(1);
  act(() => useAnalysisStore.setState({ pending: true }));
  fireEvent.keyDown(document.body, { key: 'e', ...primary });
  expect(exported).toHaveBeenCalledTimes(1);
  view.unmount();
  window.removeEventListener('keyboard-export-csv', exported);
});
