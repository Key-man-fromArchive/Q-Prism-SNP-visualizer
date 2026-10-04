import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('@/lib/api', () => ({ ApiError: class extends Error {}, logout: vi.fn(), saveAsgResult: vi.fn(), getMarkers: vi.fn().mockResolvedValue({ markers: [] }) }));
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ isDark: false, toggle: vi.fn() }) }));
vi.mock('@/hooks/use-exports', () => ({ useExports: () => ({}) }));
vi.mock('@/hooks/use-undo-redo', () => ({ useUndoRedo: () => ({ canUndo: false, canRedo: false }) }));
vi.mock('@/components/shared/QcBadges', () => ({ QcBadges: () => null }));
vi.mock('@/components/analysis/AddToProjectButton', () => ({ AddToProjectButton: () => null }));

beforeEach(() => {
  useLanguageStore.getState().setLanguage('ko');
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ expertMode: false });
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'StepOnePlus', allele2_dye: 'VIC',
    num_wells: 96, num_cycles: 7, has_rox: true, data_windows: null, suggested_cycle: 0, well_groups: null } });
});

it('keeps the well count chip but drops the cycle count chip', () => {
  render(<Header />);
  expect(screen.getByText(/96/)).toBeInTheDocument();
  expect(document.getElementById('cycles-badge')).toBeNull();
});
