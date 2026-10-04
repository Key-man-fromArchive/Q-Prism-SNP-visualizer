// P13-FE - expert mode is a switch at the right end of the tab row, on every tab.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TabNavigation } from './TabNavigation';
import { Header } from './Header';
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
  useSettingsStore.setState({ expertMode: false });
});

it('is a labelled switch whose state follows the setting', () => {
  render(<TabNavigation activeTab="results" onTabChange={vi.fn()} />);
  const sw = screen.getByRole('switch', { name: '전문가 모드' });
  expect(sw).toHaveAttribute('data-testid', 'expert-mode-toggle');
  expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(sw).toHaveAttribute('title');
  fireEvent.click(sw);
  expect(useSettingsStore.getState().expertMode).toBe(true);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

it('is labelled in English and shown on any tab', () => {
  useLanguageStore.getState().setLanguage('en');
  render(<TabNavigation activeTab="library" onTabChange={vi.fn()} hasSession={false} />);
  expect(screen.getByRole('switch', { name: 'Expert mode' })).toBeInTheDocument();
});

it('is no longer duplicated in the header', () => {
  render(<Header />);
  expect(screen.queryByTestId('expert-mode-toggle')).toBeNull();
});
