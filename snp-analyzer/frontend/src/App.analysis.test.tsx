import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from './App';
import { useAuthStore } from '@/stores/auth-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';

vi.mock('@/lib/api', () => ({ getAuthConfig: vi.fn(() => new Promise(() => {})), getMe: vi.fn(), asgLaunch: vi.fn(), asgLaunchCookie: vi.fn(), setWellTypes: vi.fn() }));
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/upload/UploadZone', () => ({ UploadZone: ({ onGoToProject }: { onGoToProject: () => void }) => <button onClick={onGoToProject}>Open project</button> }));
vi.mock('@/components/batch/BatchTab', () => ({ BatchTab: () => <div>Synthetic projects</div> }));
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: () => ({ showHelp: false, setShowHelp: vi.fn() }) }));
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ toggle: vi.fn() }), useIsDarkMode: () => false }));
vi.mock('plotly.js-dist-min', () => ({ default: {} }));
vi.mock('@/hooks/use-exports', () => ({ useExports: () => ({ downloadCSV: vi.fn() }) }));
vi.mock('@/hooks/use-undo-redo', () => ({ useUndoRedo: () => ({ undo: vi.fn(), redo: vi.fn() }) }));
it('uses navigation ownership and disconnects its result projection on unmount', async () => {
  useAuthStore.getState().setUser({ id: 'u', username: 'synthetic', display_name: null, role: 'user' });
  useNavigationStore.getState().clear();
  const view = render(<App />);
  fireEvent.click(screen.getByText('Open project'));
  expect(useNavigationStore.getState().tab).toBe('project');
  expect(screen.getByText('Synthetic projects')).toBeInTheDocument();
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
