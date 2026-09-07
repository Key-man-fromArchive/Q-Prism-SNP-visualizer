import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import { saveAsgResult } from '@/lib/api';

vi.mock('@/lib/api', () => ({ logout: vi.fn(), saveAsgResult: vi.fn() }));
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ isDark: false, toggle: vi.fn() }) }));
vi.mock('@/hooks/use-exports', () => ({ useExports: () => ({}) }));
vi.mock('@/hooks/use-undo-redo', () => ({ useUndoRedo: () => ({ canUndo: false, canRedo: false }) }));
vi.mock('@/components/shared/QcBadges', () => ({ QcBadges: () => null }));
vi.mock('@/components/analysis/AddToProjectButton', () => ({ AddToProjectButton: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', sessionInfo: null });
  useSelectionStore.setState({ currentCycle: 20 });
  useSettingsStore.setState({ useRox: false });
  useAuthStore.setState({ user: null, authMode: 'asg_launch', linkedContext: {
    target_type: 'marker', target_id: 'synthetic', context: {}, scope: ['snp:save_result'], expires_at: null,
  } });
});

it.each(['session', 'cycle', 'rox', 'mutation'])('discards pending ASG save after %s changes', async (change) => {
  let reject!: (error: Error) => void;
  vi.mocked(saveAsgResult).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: 'ASG' }));
  expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
  act(() => {
    if (change === 'session') useSessionStore.setState({ sessionId: 'run-b' });
    else if (change === 'cycle') useSelectionStore.setState({ currentCycle: 21 });
    else if (change === 'rox') useSettingsStore.setState({ useRox: true });
    else window.dispatchEvent(new Event('asg-result-dirty'));
  });
  await act(async () => reject(new Error('old request error')));
  expect(screen.getByRole('button', { name: 'ASG' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'ASG' })).not.toHaveAttribute('title', 'old request error');
});
